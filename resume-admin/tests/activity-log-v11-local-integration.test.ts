// TEST ONLY: end-to-end frozen Worker -> local PostgREST -> frozen RPC coverage.
// Run through run-v11-local-integration.mjs after the documented local db reset.
import { afterAll, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { canonicalizeAwards, handleWorkerRequest, serializePostgresJsonbObject, type WorkerEnv } from "../src/worker/index";
import { deriveActivityLogV13FailureEventId } from "../src/worker/activityLogV13";

const enabled = process.env.V11_LOCAL_INTEGRATION === "1";
const apiBase = process.env.V11_LOCAL_API_URL;
const workerSupabaseUrl = process.env.V11_LOCAL_WORKER_SUPABASE_URL;
const publishableKey = process.env.V11_LOCAL_PUBLISHABLE_KEY;
const userJwt = process.env.V11_LOCAL_USER_JWT;
const ownerJwt = process.env.V11_LOCAL_OWNER_JWT;
const testKeyHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const testV13KeyHex = "a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7";
const targetId = "ea111111-1111-4111-8111-111111111111";
const officialId = "20000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const ownerId = "10000000-0000-4000-8000-000000000001";
const dbContainer = "supabase_db_example-cv-admin-rls-local-test";
const originalFetch = globalThis.fetch;
const expectedLocalApiOrigin = "http://127.0.0.1:55421";
const workerUpstreamOrigin = "https://local.supabase.invalid";
const localUuid = randomUUID;
let mutateNextRpcPayload: ((payload: Record<string, unknown>) => Record<string, unknown>) | undefined;
let mutateNextAwardsRpcPayload: ((payload: Record<string, unknown>) => Record<string, unknown>) | undefined;
let dropNextV13RecorderResponseAfterCommit = false;
let dropNextAwardsRpcResponseAfterCommit = false;
let lastAwardsRpcFailure: { status: number; code: string | null; message: string | null } | null = null;
const v13RecorderBodies: string[] = [];

if (enabled) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.origin !== workerUpstreamOrigin) throw new Error("Local integration refused a non-fixture Worker upstream");
    url.protocol = "http:";
    url.hostname = "127.0.0.1";
    url.port = "55421";
    let forwardedInit = init;
    if (url.pathname === "/rest/v1/rpc/save_resume_introduction_v11" && typeof init?.body === "string" && mutateNextRpcPayload) {
      const mutate = mutateNextRpcPayload;
      mutateNextRpcPayload = undefined;
      forwardedInit = { ...init, body: JSON.stringify(mutate(JSON.parse(init.body) as Record<string, unknown>)) };
    }
    if (url.pathname === "/rest/v1/rpc/save_resume_awards_v1" && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const forwarded = mutateNextAwardsRpcPayload ? { ...init, body: JSON.stringify(mutateNextAwardsRpcPayload(body)) } : init;
      mutateNextAwardsRpcPayload = undefined;
      lastAwardsRpcFailure = null;
      const response = await originalFetch(url, forwarded);
      if (!response.ok) {
        const failure = await response.clone().json().catch(() => null) as { code?: unknown; message?: unknown } | null;
        lastAwardsRpcFailure = { status: response.status, code: typeof failure?.code === "string" ? failure.code : null,
          message: typeof failure?.message === "string" ? failure.message : null };
      }
      if (dropNextAwardsRpcResponseAfterCommit && response.ok) {
        dropNextAwardsRpcResponseAfterCommit = false;
        return Response.json({ code: "synthetic_response_lost_after_commit" }, { status: 503 });
      }
      return response;
    }
    if (url.pathname === "/rest/v1/rpc/record_activity_log_system_failure" && typeof init?.body === "string") {
      v13RecorderBodies.push(init.body);
      const response = await originalFetch(url, forwardedInit);
      if (dropNextV13RecorderResponseAfterCommit) {
        dropNextV13RecorderResponseAfterCommit = false;
        return Response.json({ code: "synthetic_response_lost_after_commit" }, { status: 503 });
      }
      return response;
    }
    return originalFetch(url, forwardedInit);
  }) as typeof fetch;
}

function assertLocalConfiguration(): void {
  if (!apiBase || new URL(apiBase).origin !== expectedLocalApiOrigin
    || !workerSupabaseUrl || new URL(workerSupabaseUrl).origin !== "https://local.supabase.invalid"
    || !publishableKey || !userJwt || !ownerJwt) {
    throw new Error("Local V1.1 integration environment is incomplete or not loopback-only");
  }
}

function workerEnv(keyId = "activity_log_v11_hmac_v1", enableV13B = false): WorkerEnv {
  assertLocalConfiguration();
  return {
    ASSETS: { fetch: async () => new Response("not used", { status: 404 }) },
    SUPABASE_URL: workerSupabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    ACTIVITY_LOG_HMAC_KEY_ID: keyId,
    ACTIVITY_LOG_HMAC_KEY: testKeyHex,
    ACTIVITY_LOG_V13_HMAC_KEY: testV13KeyHex,
    ACTIVITY_LOG_V13B_FAILURE_REPORTING: enableV13B ? "true" : "false",
  };
}

async function rest(path: string, init: RequestInit = {}, bearer = userJwt!): Promise<unknown> {
  assertLocalConfiguration();
  const response = await originalFetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey!,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(`Local Supabase read failed (${response.status})`);
  return body;
}

async function readItems(target = targetId, bearer = userJwt!): Promise<Array<{ id: string; zh: string; en: string; position: number }>> {
  const rows = await rest(`/rest/v1/resume_intro_paragraphs?select=id,position&resume_id=eq.${target}&order=position.asc`, {}, bearer) as Array<{ id: string; position: number }>;
  const translations = await rest(`/rest/v1/resume_intro_paragraph_translations?select=paragraph_id,locale,text&resume_id=eq.${target}`, {}, bearer) as Array<{ paragraph_id: string; locale: string; text: string }>;
  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    zh: translations.find((entry) => entry.paragraph_id === row.id && entry.locale === "zh")?.text ?? "",
    en: translations.find((entry) => entry.paragraph_id === row.id && entry.locale === "en")?.text ?? "",
  }));
}

async function readEvents(target = targetId, bearer = userJwt!): Promise<Array<Record<string, unknown>>> {
  return await rest(`/rest/v1/rpc/read_activity_log_events`, {
    method: "POST",
    body: JSON.stringify({ target_resume_id: target, page_limit: 100, before_occurred_at: null, before_id: null }),
  }, bearer) as Array<Record<string, unknown>>;
}

type LocalAward = { id: string; position: number; zh: { name: string; year: string }; en: { name: string; year: string } };
async function readAwards(target = targetId, bearer = userJwt!): Promise<LocalAward[]> {
  const parents = await rest(`/rest/v1/resume_award_entries?select=id,position&resume_id=eq.${target}&order=position.asc`, {}, bearer) as Array<{ id: string; position: number }>;
  const translations = await rest(`/rest/v1/resume_award_translations?select=award_entry_id,locale,name,year&resume_id=eq.${target}`, {}, bearer) as Array<{ award_entry_id: string; locale: string; name: string; year: string }>;
  return parents.map(parent => {
    const zh = translations.find(row => row.award_entry_id === parent.id && row.locale === "zh");
    const en = translations.find(row => row.award_entry_id === parent.id && row.locale === "en");
    return { id: parent.id, position: parent.position,
      zh: { name: zh?.name ?? "", year: zh?.year ?? "" }, en: { name: en?.name ?? "", year: en?.year ?? "" } };
  });
}
async function readUnifiedEvents(target = targetId, bearer = userJwt!): Promise<Array<Record<string, unknown>>> {
  return await rest("/rest/v1/rpc/read_activity_log_events_v13c", { method: "POST", body: JSON.stringify({ target_resume_id: target, page_limit: 100, event_filter: "successful" }) }, bearer) as Array<Record<string, unknown>>;
}

type LocalProject = { id: string; position: number; source_key: string | null; zh: Record<string, string>; en: Record<string, string>; methods: { zh: Array<{ id: string; position: number; value: string }>; en: Array<{ id: string; position: number; value: string }> } };
async function readProjects(target = targetId, bearer = userJwt!): Promise<LocalProject[]> {
  const parents = await rest(`/rest/v1/resume_project_entries?select=id,position,source_key&resume_id=eq.${target}&order=position.asc,id.asc`, {}, bearer) as Array<{ id: string; position: number; source_key: string | null }>;
  const translations = await rest(`/rest/v1/resume_project_translations?select=project_entry_id,locale,title,subtitle,period,description,href&resume_id=eq.${target}`, {}, bearer) as Array<{ project_entry_id: string; locale: string; title: string; subtitle: string; period: string; description: string; href: string }>;
  const methods = await rest(`/rest/v1/resume_project_methods?select=id,project_entry_id,locale,position,value&resume_id=eq.${target}&order=position.asc,id.asc`, {}, bearer) as Array<{ id: string; project_entry_id: string; locale: string; position: number; value: string }>;
  return parents.map(parent => {
    const locale = (key: "zh" | "en") => {
      const row = translations.find(value => value.project_entry_id === parent.id && value.locale === key);
      if (!row) throw new Error("Local Projects fixture is missing a required locale");
      return { title: row.title, subtitle: row.subtitle, period: row.period, description: row.description, href: row.href };
    };
    const localeMethods = (key: "zh" | "en") => methods.filter(method => method.project_entry_id === parent.id && method.locale === key)
      .map(({ id, position, value }) => ({ id, position, value }));
    return { ...parent, zh: locale("zh"), en: locale("en"), methods: { zh: localeMethods("zh"), en: localeMethods("en") } };
  });
}

async function readProjectsWriteState(target = targetId, bearer = userJwt!): Promise<Array<Record<string, unknown>>> {
  return await rest("/rest/v1/rpc/load_admin_projects_write_state", { method: "POST", body: JSON.stringify({ target_resume_id: target }) }, bearer) as Array<Record<string, unknown>>;
}

function localSql(sql: string): string {
  return execFileSync("docker", ["exec", dbContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim().split(/\r?\n/, 1)[0];
}

function nearLimitAwards(): Array<{ id: null; position: number; zh: { name: string; year: string }; en: { name: string; year: string } }> {
  const items: Array<{ id: null; position: number; zh: { name: string; year: string }; en: { name: string; year: string } }> = [];
  const full = (position: number, zhNameLength = 200) => ({ id: null as null, position,
    zh: { name: "x".repeat(zhNameLength), year: "2".repeat(64) },
    en: { name: "A".repeat(200), year: "2".repeat(64) } });
  const encoder = new TextEncoder();
  for (let position = 0; position < 32; position += 1) {
    const complete = [...items, full(position)];
    if (encoder.encode(canonicalizeAwards(complete)).byteLength <= 4096) {
      items.push(full(position));
      continue;
    }
    let low = 0; let high = 200; let best: ReturnType<typeof full> | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = full(position, middle);
      if (encoder.encode(canonicalizeAwards([...items, candidate])).byteLength <= 4096) {
        best = candidate; low = middle + 1;
      } else high = middle - 1;
    }
    if (best) items.push(best);
    break;
  }
  return items;
}

function makeRequest(items: Array<{ id: string | null; zh: string; en: string }>, requestId: string = localUuid(), token = userJwt!, target = targetId, clientIp = "203.0.113.89"): Request {
  const request = new Request("https://admin.local.test/api/admin/v1/introduction/save", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "CF-Connecting-IP": clientIp,
      "X-Forwarded-For": "198.51.100.77",
    },
    body: JSON.stringify({ request_id: requestId, resume_id: target, items }),
  });
  Object.defineProperty(request, "cf", { value: { country: "US", region: "Test Region", city: "Test City" } });
  return request;
}
function makeAwardsRequest(awards: Array<{ id: string | null; position: number; zh: { name: string; year: string }; en: { name: string; year: string } }>, requestId: string = localUuid(), token = userJwt!, target = targetId): Request {
  const request = new Request("https://admin.local.test/api/admin/v1/awards/save", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.89" },
    body: JSON.stringify({ request_id: requestId, resume_id: target, awards }) });
  Object.defineProperty(request, "cf", { value: { country: "US", region: "Test Region", city: "Test City" } });
  return request;
}

async function invoke(items: Array<{ id: string | null; zh: string; en: string }>, requestId?: string, token?: string, target = targetId, clientIp?: string, signingKeyId?: string, mutateRpcPayload?: (payload: Record<string, unknown>) => Record<string, unknown>, enableV13B = false): Promise<{ response: Response; body: unknown }> {
  mutateNextRpcPayload = mutateRpcPayload;
  try {
    const response = await handleWorkerRequest(makeRequest(items, requestId, token, target, clientIp), workerEnv(signingKeyId, enableV13B));
    return { response, body: await response.json() };
  } finally {
    mutateNextRpcPayload = undefined;
  }
}
async function invokeAwards(awards: Array<{ id: string | null; position: number; zh: { name: string; year: string }; en: { name: string; year: string } }>, requestId?: string, token?: string, target = targetId, mutateRpcPayload?: (payload: Record<string, unknown>) => Record<string, unknown>): Promise<{ response: Response; body: unknown }> {
  mutateNextAwardsRpcPayload = mutateRpcPayload;
  try {
    const response = await handleWorkerRequest(makeAwardsRequest(awards, requestId, token, target), workerEnv());
    return { response, body: await response.json() };
  } finally { mutateNextAwardsRpcPayload = undefined; }
}
type LocalProjectsSavePayload = Array<{
  id: string | null; position: number; zh: Record<string, string>; en: Record<string, string>;
  methods: { zh: Array<{ id: string | null; position: number; value: string }>; en: Array<{ id: string | null; position: number; value: string }> };
}>;
async function invokeProjects(projects: LocalProjectsSavePayload, requestId = localUuid(), token = userJwt!, target = targetId): Promise<{ response: Response; body: unknown }> {
  const request = new Request("https://admin.local.test/api/admin/v1/projects/save", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.89" },
    body: JSON.stringify({ request_id: requestId, resume_id: target, projects }) });
  Object.defineProperty(request, "cf", { value: { country: "US", region: "Test Region", city: "Test City" } });
  const response = await handleWorkerRequest(request, workerEnv());
  return { response, body: await response.json() };
}

function rpcRows(body: unknown): Array<{ id: string; position: number; translations: { zh: { text: string }; en: { text: string } } }> {
  if (!Array.isArray(body)) throw new Error("Worker returned a non-array canonical Introduction result");
  return body as ReturnType<typeof rpcRows>;
}

async function runWithTwoDatabaseSessionsBlocked<T>(target: string, operation: () => Promise<T>, rpcName = "save_resume_introduction_v11"): Promise<T> {
  if (process.env.V11_LOCAL_DB_CONTAINER !== dbContainer) throw new Error("Concurrency test refused an unexpected database container");
  const blocker = spawn("docker", ["exec", "-i", dbContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"]);
  let output = "";
  blocker.stdout.setEncoding("utf8");
  blocker.stdout.on("data", (chunk: string) => { output += chunk; });
  const exit = new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Local row-lock session failed")));
  });
  let released = false;
  const release = async () => {
    if (!released) {
      released = true;
      if (!blocker.stdin.destroyed && blocker.exitCode === null) blocker.stdin.write("COMMIT;\n\\q\n");
    }
    await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 3000))]);
  };
  blocker.stdin.write(`BEGIN; SELECT id FROM public.resume_sites WHERE id='${target}'::uuid FOR UPDATE; SELECT 'D_LOCK_HELD';\n`);
  const deadline = Date.now() + 5000;
  while (!output.includes("D_LOCK_HELD") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  if (!output.includes("D_LOCK_HELD")) {
    await release();
    throw new Error("Could not establish the local target-row lock barrier");
  }
  const pending = operation();
  try {
    let blockedSessions = 0;
    const waitDeadline = Date.now() + 8000;
    while (Date.now() < waitDeadline) {
      const count = execFileSync("docker", ["exec", dbContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-c",
        `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%${rpcName}%'`], { encoding: "utf8" }).trim();
      blockedSessions = Number(count);
      if (blockedSessions >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (blockedSessions < 2) {
      await release();
      await pending;
      throw new Error(`Expected two concurrent authenticated PostgREST database sessions waiting on the same target row; observed ${blockedSessions}`);
    }
    await release();
    return await pending;
  } catch (error) {
    await release();
    throw error;
  }
}

describe.skipIf(!enabled)("Activity Log V1.1 local Worker/PostgREST integration", () => {
  let baseline: Array<{ id: string; zh: string; en: string; position: number }>;
  let baselineEvents: number;
  let officialBaseline: Array<{ id: string; zh: string; en: string; position: number }>;

  afterAll(async () => {
    if (!baseline || !enabled) return;
    const restored = await invoke(baseline.map(({ id, zh, en }) => ({ id, zh, en })));
    if (!restored.response.ok) throw new Error("Local integration cleanup could not restore the QA fixture Introduction");
    expect(await readItems()).toEqual(baseline);
    if (officialBaseline) {
      const officialRestored = await invoke(officialBaseline.map(({ id, zh, en }) => ({ id, zh, en })), undefined, ownerJwt!, officialId);
      if (!officialRestored.response.ok) throw new Error("Local integration cleanup could not restore the official-like local fixture Introduction");
      expect(await readItems(officialId, ownerJwt!)).toEqual(officialBaseline);
    }
  });

  it("integrates signed Worker saves, retry semantics, trusted context, idempotency scopes, and two-session concurrency", async () => {
    assertLocalConfiguration();
    const featureState = await rest(`/rest/v1/rpc/load_admin_feature_state_v11`, {
      method: "POST", body: JSON.stringify({ target_resume_id: targetId }),
    }) as Array<{ activity_log_enabled: boolean; introduction_write_mode: string; introduction_trusted_context_required: boolean }>;
    expect(featureState).toEqual([{ activity_log_enabled: true, introduction_write_mode: "rpc", introduction_trusted_context_required: false }]);

    const officialFeatureState = await rest(`/rest/v1/rpc/load_admin_feature_state_v11`, {
      method: "POST", body: JSON.stringify({ target_resume_id: officialId }),
    }, ownerJwt!) as Array<{ activity_log_enabled: boolean; introduction_write_mode: string; introduction_trusted_context_required: boolean }>;
    expect(officialFeatureState).toEqual([{ activity_log_enabled: false, introduction_write_mode: "direct", introduction_trusted_context_required: false }]);

    baseline = await readItems();
    baselineEvents = (await readEvents()).length;
    officialBaseline = await readItems(officialId, ownerJwt!);
    expect(baseline.length).toBeGreaterThan(0);

    // Exercise the untrusted direct/off path through PostgREST before enabling
    // the frozen legacy RPC and V1.1 trusted-context paths below.
    localSql(`UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id='${targetId}'::uuid AND domain_key='introduction'`);
    const directState = await rest(`/rest/v1/rpc/load_admin_feature_state_v11`, {
      method: "POST", body: JSON.stringify({ target_resume_id: targetId }),
    }) as Array<{ activity_log_enabled: boolean; introduction_write_mode: string; introduction_trusted_context_required: boolean }>;
    expect(directState).toEqual([{ activity_log_enabled: true, introduction_write_mode: "direct", introduction_trusted_context_required: false }]);
    const directItem = baseline[0];
    const directHeaders = { apikey: publishableKey!, Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json", Prefer: "return=minimal" };
    const directPath = `/rest/v1/resume_intro_paragraph_translations?resume_id=eq.${targetId}&paragraph_id=eq.${directItem.id}&locale=eq.zh`;
    const directWrite = await originalFetch(`${apiBase}${directPath}`, {
      method: "PATCH", headers: directHeaders, body: JSON.stringify({ text: `${directItem.zh} direct-path` }),
    });
    expect(directWrite.status).toBe(204);
    expect((await readItems())[0]?.zh).toBe(`${directItem.zh} direct-path`);
    expect((await readEvents()).length).toBe(baselineEvents);
    const directRestore = await originalFetch(`${apiBase}${directPath}`, {
      method: "PATCH", headers: directHeaders, body: JSON.stringify({ text: directItem.zh }),
    });
    expect(directRestore.status).toBe(204);
    expect(await readItems()).toEqual(baseline);
    expect((await readEvents()).length).toBe(baselineEvents);

    localSql(`UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='${targetId}'::uuid AND domain_key='introduction'`);
    const legacyState = await rest(`/rest/v1/rpc/load_admin_feature_state_v11`, {
      method: "POST", body: JSON.stringify({ target_resume_id: targetId }),
    }) as Array<{ activity_log_enabled: boolean; introduction_write_mode: string; introduction_trusted_context_required: boolean }>;
    expect(legacyState).toEqual([{ activity_log_enabled: true, introduction_write_mode: "rpc", introduction_trusted_context_required: false }]);
    const legacyItems = baseline.map(({ id, zh, en }) => ({ id, zh: `${zh} legacy-path`, en }));
    const legacySave = await originalFetch(`${apiBase}/rest/v1/rpc/save_resume_introduction`, {
      method: "POST", headers: directHeaders,
      body: JSON.stringify({ target_resume_id: targetId, target_items: legacyItems }),
    });
    expect(legacySave.ok).toBe(true);
    expect((await readItems()).map(({ zh }) => zh)).toEqual(legacyItems.map(({ zh }) => zh));
    expect((await readEvents()).length).toBe(baselineEvents + 1);
    baselineEvents = (await readEvents()).length;

    localSql(`INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled) VALUES ('${targetId}'::uuid,'introduction','trusted_network_context_v11',true) ON CONFLICT (resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true; INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled) VALUES ('${officialId}'::uuid,'activity_log',true) ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=true; UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='${officialId}'::uuid AND domain_key='introduction'; INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled) VALUES ('${officialId}'::uuid,'introduction','trusted_network_context_v11',true) ON CONFLICT (resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true`);
    const qaV11State = await rest(`/rest/v1/rpc/load_admin_feature_state_v11`, {
      method: "POST", body: JSON.stringify({ target_resume_id: targetId }),
    }) as Array<{ activity_log_enabled: boolean; introduction_write_mode: string; introduction_trusted_context_required: boolean }>;
    expect(qaV11State).toEqual([{ activity_log_enabled: true, introduction_write_mode: "rpc", introduction_trusted_context_required: true }]);

    // V1.3B is a local-only proof that a valid semantic no-op can reserve an
    // idempotency key, then a different payload with that key is rejected
    // before Introduction DML while its separately signed failure event is
    // recorded exactly once. The first recorder response is deliberately lost
    // after commit to prove the bounded retry reuses the exact envelope.
    localSql(`INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled) VALUES ('${targetId}'::uuid,'activity_log_system_events',true) ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=true`);
    const v13BeforeItems = await readItems();
    const v13BeforeActivityEvents = (await readEvents()).length;
    const v13RequestId = localUuid();
    const noOpSeed = await invoke(v13BeforeItems.map(({ id, zh, en }) => ({ id, zh, en })), v13RequestId);
    expect(noOpSeed.response.status).toBe(200);
    expect(await readItems()).toEqual(v13BeforeItems);
    expect((await readEvents()).length).toBe(v13BeforeActivityEvents);

    const v13BeforeFailureCount = Number(localSql(`SELECT count(*) FROM cms_private.activity_log_system_events WHERE resume_id='${targetId}'::uuid`));
    const v13ChangedItems = v13BeforeItems.map(({ id, zh, en }) => ({ id, zh: `${zh} different digest`, en }));
    v13RecorderBodies.length = 0;
    dropNextV13RecorderResponseAfterCommit = true;
    const v13Conflict = await invoke(v13ChangedItems, v13RequestId, undefined, targetId, undefined, undefined, undefined, true);
    expect(v13Conflict.response.status).toBe(409);
    expect((v13Conflict.body as { error: { code: string } }).error.code).toBe("idempotency_conflict");
    expect(await readItems()).toEqual(v13BeforeItems);
    expect((await readEvents()).length).toBe(v13BeforeActivityEvents);
    expect(v13RecorderBodies).toHaveLength(2);
    expect(v13RecorderBodies[0]).toBe(v13RecorderBodies[1]);
    const failurePayload = JSON.parse(v13RecorderBodies[0]!) as Record<string, unknown>;
    const expectedFailureEventId = await deriveActivityLogV13FailureEventId({
      resumeId: targetId,
      actorUserId: actorId,
      requestId: v13RequestId,
      failureStage: "idempotency",
      failureCode: "idempotency_conflict",
    });
    expect(failurePayload.target_event_id).toBe(expectedFailureEventId);
    expect(failurePayload.target_request_id).toBe(v13RequestId);
    expect(Number(localSql(`SELECT count(*) FROM cms_private.activity_log_system_events WHERE resume_id='${targetId}'::uuid`)))
      .toBe(v13BeforeFailureCount + 1);
    expect(localSql(`SELECT count(*) || ':' || bool_and(actor_user_id='${actorId}'::uuid AND request_id='${v13RequestId}'::uuid AND event_kind='operation_failure' AND outcome='rejected' AND section_key='introduction' AND operation='update' AND failure_stage='idempotency' AND failure_code='idempotency_conflict' AND ip_network='203.0.113.0/24'::cidr) FROM cms_private.activity_log_system_events WHERE resume_id='${targetId}'::uuid AND event_id='${expectedFailureEventId}'::uuid`))
      .toBe("1:true");

    const replayedConflict = await invoke(v13ChangedItems, v13RequestId, undefined, targetId, undefined, undefined, undefined, true);
    expect(replayedConflict.response.status).toBe(409);
    expect((await readItems())).toEqual(v13BeforeItems);
    expect(v13RecorderBodies).toHaveLength(3);
    const replayPayload = JSON.parse(v13RecorderBodies[2]!) as Record<string, unknown>;
    expect(replayPayload.target_event_id).toBe(expectedFailureEventId);
    expect(Number(localSql(`SELECT count(*) FROM cms_private.activity_log_system_events WHERE resume_id='${targetId}'::uuid`)))
      .toBe(v13BeforeFailureCount + 1);

    const ordered = [...baseline].reverse();
    const added = { id: `local-${Date.now()}-0`, zh: "D integration local item", en: "D integration local item" };
    const requested = [...ordered.map(({ id, zh, en }) => ({ id, zh, en })), added];
    const rejectedMutation = [...(await readItems()).map(({ id, zh, en }) => ({ id, zh: `${zh} must be rejected`, en }))];
    const beforeRejectedItems = await readItems();
    const beforeRejectedEvents = (await readEvents()).length;

    const invalidKeyId = await invoke(rejectedMutation, localUuid(), undefined, targetId, undefined, "wrong-local-test-key-id");
    expect(invalidKeyId.response.status).toBe(502);
    expect(await readItems()).toEqual(beforeRejectedItems);
    expect((await readEvents()).length).toBe(beforeRejectedEvents);

    const tamperedSignature = await invoke(rejectedMutation, undefined, undefined, targetId, undefined, undefined, (payload) => ({
      ...payload,
      signature_hex: `${String(payload.signature_hex).startsWith("0") ? "1" : "0"}${String(payload.signature_hex).slice(1)}`,
    }));
    expect(tamperedSignature.response.status).toBe(502);
    expect(await readItems()).toEqual(beforeRejectedItems);
    expect((await readEvents()).length).toBe(beforeRejectedEvents);

    const signedFields: Array<[string, (value: unknown) => unknown]> = [
      ["actor_user_id", () => ownerId],
      ["resume_id", () => officialId],
      ["domain", () => "projects"],
      ["operation", () => "delete"],
      ["request_id", () => localUuid()],
      ["mutation_digest", () => "0".repeat(64)],
      ["issued_at", (value) => Number(value) + 1],
      ["expires_at", (value) => Number(value) + 1],
    ];
    for (const [field, replace] of signedFields) {
      const result = await invoke(rejectedMutation, undefined, undefined, targetId, undefined, undefined, (payload) => {
        const context = JSON.parse(String(payload.signed_context)) as Record<string, unknown>;
        context[field] = replace(context[field]);
        return { ...payload, signed_context: serializePostgresJsonbObject(context) };
      });
      expect(result.response.status, `${field} binding`).toBe(502);
      expect(await readItems()).toEqual(beforeRejectedItems);
      expect((await readEvents()).length).toBe(beforeRejectedEvents);
    }

    const requestId = localUuid();
    const first = await invoke(requested, requestId);
    expect(first.response.status).toBe(200);
    const canonical = rpcRows(first.body);
    expect(canonical).toHaveLength(requested.length);
    expect(canonical.map((row) => row.position)).toEqual(requested.map((_, index) => index));
    expect(canonical.at(-1)?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(canonical.at(-1)?.translations).toEqual({ zh: { text: added.zh }, en: { text: added.en } });

    const persisted = await readItems();
    expect(persisted.map(({ id, position, zh, en }) => ({ id, position, zh, en }))).toEqual(canonical.map((row) => ({
      id: row.id, position: row.position, zh: row.translations.zh.text, en: row.translations.en.text,
    })));
    const eventsAfterSave = await readEvents();
    expect(eventsAfterSave).toHaveLength(baselineEvents + 1);
    const event = eventsAfterSave[0];
    expect(event).toMatchObject({ actor_user_id: actorId, resume_id: targetId, section_key: "introduction", operation: "update" });
    expect(event.actor_role_snapshot).toBe("qa");

    const retry = await invoke(requested, requestId);
    expect(retry.response.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect((await readEvents())).toHaveLength(baselineEvents + 1);

    const persistedCanonicalInput = canonical.map((row) => ({
      id: row.id,
      zh: row.translations.zh.text,
      en: row.translations.en.text,
    }));
    const noOp = await invoke(persistedCanonicalInput);
    expect(noOp.response.status).toBe(200);
    expect((await readEvents())).toHaveLength(baselineEvents + 1);

    const conflict = await invoke(requested.map((item, index) => index === 0 ? { ...item, zh: `${item.zh} conflict` } : item), requestId);
    expect(conflict.response.status).toBe(409);
    expect((await readEvents())).toHaveLength(baselineEvents + 1);

    const ipv6Items = (await readItems()).map(({ id, zh, en }) => ({ id, zh: `${zh} IPv6`, en }));
    const ipv6Save = await invoke(ipv6Items, localUuid(), undefined, targetId, "2001:db8:abcd:1234::1");
    expect(ipv6Save.response.status).toBe(200);
    expect((await readEvents())[0]).toMatchObject({ actor_user_id: actorId, resume_id: targetId, section_key: "introduction", operation: "update" });
    expect(localSql(`SELECT EXISTS (SELECT 1 FROM cms_private.activity_log_events WHERE resume_id='${targetId}'::uuid AND ip_network='2001:db8:abcd::/48'::cidr AND country_code='US' AND region='Test Region' AND city='Test City')`)).toBe("t");
    expect((await readEvents())).toHaveLength(baselineEvents + 2);

    // Re-prove A -> B -> retry A through the Worker/PostgREST path. A adds a
    // generated paragraph, B becomes current, and replaying A must not restore A.
    const aRequestId = localUuid();
    const aItems = [...(await readItems()).map(({ id, zh, en }) => ({ id, zh: `${zh} A`, en })),
      { id: `local-${Date.now()}-0`, zh: "Worker A generated paragraph", en: "Worker A generated paragraph" }];
    const eventsBeforeAB = (await readEvents()).length;
    const resultA = await invoke(aItems, aRequestId);
    expect(resultA.response.status).toBe(200);
    const resultARows = rpcRows(resultA.body);
    expect(resultARows.at(-1)?.id).toMatch(/^[0-9a-f-]{36}$/i);
    const bItems = resultARows.map((row) => ({ id: row.id, zh: row.translations.zh.text, en: `${row.translations.en.text} B` }));
    const resultB = await invoke(bItems, localUuid());
    expect(resultB.response.status).toBe(200);
    const resultBRows = rpcRows(resultB.body);
    expect((await readItems()).map(({ id, position, zh, en }) => ({ id, position, zh, en }))).toEqual(resultBRows.map((row) => ({
      id: row.id, position: row.position, zh: row.translations.zh.text, en: row.translations.en.text,
    })));
    const replayA = await invoke(aItems, aRequestId);
    expect(replayA.response.status).toBe(200);
    expect(replayA.body).toEqual(resultA.body);
    expect((await readItems()).map(({ id, zh, en }) => ({ id, zh, en }))).toEqual(resultBRows.map((row) => ({
      id: row.id, zh: row.translations.zh.text, en: row.translations.en.text,
    })));
    expect((await readEvents()).length).toBe(eventsBeforeAB + 2);

    // An expired idempotency record is rejected at the same Worker boundary.
    const expiryRequestId = localUuid();
    const expiryItems = (await readItems()).map(({ id, zh, en }) => ({ id, zh: `${zh} expiry`, en }));
    const beforeExpiryEvents = (await readEvents()).length;
    const expirySave = await invoke(expiryItems, expiryRequestId);
    expect(expirySave.response.status).toBe(200);
    expect(localSql(`UPDATE cms_private.activity_log_idempotency AS record SET created_at=expired.expired_at,completed_at=expired.expired_at,expires_at=expired.expired_at+interval '7 days' FROM (SELECT pg_catalog.clock_timestamp()-interval '8 days' AS expired_at) AS expired WHERE record.actor_user_id='${actorId}'::uuid AND record.resume_id='${targetId}'::uuid AND record.domain_key='introduction' AND record.request_id='${expiryRequestId}'::uuid RETURNING record.request_id`)).toBe(expiryRequestId);
    const expiredRetry = await invoke(expiryItems, expiryRequestId);
    expect(expiredRetry.response.status).toBe(409);
    expect((await readEvents()).length).toBe(beforeExpiryEvents + 1);
    expect((await readItems()).map(({ id, zh, en }) => ({ id, zh, en }))).toEqual(expiryItems.map(({ id, zh, en }) => ({ id, zh, en })));

    // The trusted gate cannot be bypassed through the old unsigned RPC or by
    // using a QA token against the official-like local target.
    const beforeUnsignedState = await readItems();
    const beforeUnsignedEvents = (await readEvents()).length;
    const unsigned = await originalFetch(`${apiBase}/rest/v1/rpc/save_resume_introduction`, {
      method: "POST",
      headers: { apikey: publishableKey!, Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ target_resume_id: targetId, target_items: beforeUnsignedState.map(({ id, zh, en }) => ({ id, zh, en })) }),
    });
    expect(unsigned.ok).toBe(false);
    const unauthorizedTarget = await invoke(beforeUnsignedState.map(({ id, zh, en }) => ({ id, zh, en })), localUuid(), userJwt!, officialId);
    expect(unauthorizedTarget.response.status).toBe(502);
    expect(await readItems()).toEqual(beforeUnsignedState);
    expect((await readEvents()).length).toBe(beforeUnsignedEvents);

    // Distinct JWT session identifiers, same authorized synthetic QA actor.
    const sessionToken = (sessionId: string) => {
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const header = encode({ alg: "HS256", typ: "JWT" });
      const now = Math.floor(Date.now() / 1000);
      const payload = encode({ aud: "authenticated", role: "authenticated", iss: "local-test", iat: now, exp: now + 3600,
        sub: actorId, email: "qa-local@example.invalid", session_id: sessionId,
        app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {} });
      const input = `${header}.${payload}`;
      // The test launcher supplies only a locally generated JWT secret via an ephemeral environment value.
      const secret = process.env.V11_LOCAL_JWT_SECRET;
      if (!secret) throw new Error("Local JWT signer was not provided to the integration test");
      const signature = createHmac("sha256", secret).update(input).digest("base64url");
      return `${input}.${signature}`;
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await readItems();
      const concurrentId = localUuid();
      const candidateA = [...current.map(({ id, zh, en }) => ({ id, zh: `${zh} A${attempt}`, en })),
        { id: `local-${Date.now()}-${attempt * 2 + 1}`, zh: `Concurrent A ${attempt}`, en: `Concurrent A ${attempt}` }];
      const candidateB = [...current.map(({ id, zh, en }) => ({ id, zh, en: `${en} B${attempt}` })),
        { id: `local-${Date.now()}-${attempt * 2 + 2}`, zh: `Concurrent B ${attempt}`, en: `Concurrent B ${attempt}` }];
      const [tokenA, tokenB] = await Promise.all([sessionToken(localUuid()), sessionToken(localUuid())]);
      const beforeEvents = (await readEvents()).length;
      const results = await runWithTwoDatabaseSessionsBlocked(targetId, () =>
        Promise.all([invoke(candidateA, concurrentId, tokenA), invoke(candidateB, localUuid(), tokenB)]));
      expect(results.map(({ response }) => response.status)).toEqual([200, 200]);
      for (const result of results) {
        const responseRows = rpcRows(result.body);
        expect(responseRows.map(({ position }) => position)).toEqual(responseRows.map((_, index) => index));
        expect(responseRows.every((row) => /^[0-9a-f-]{36}$/i.test(row.id))).toBe(true);
      }
      const after = await readItems();
      expect(after).toHaveLength(current.length + 1);
      expect(after.map(({ position }) => position)).toEqual(after.map((_, index) => index));
      expect(new Set(after.map(({ id }) => id)).size).toBe(after.length);
      const serializedStates = results.map((result) => rpcRows(result.body).map((row) => ({
        id: row.id, position: row.position, zh: row.translations.zh.text, en: row.translations.en.text,
      })));
      expect(serializedStates).toContainEqual(after.map(({ id, position, zh, en }) => ({ id, position, zh, en })));
      const afterEvents = await readEvents();
      expect(afterEvents).toHaveLength(beforeEvents + 2);
      expect(afterEvents.slice(0, 2).every((event) => event.actor_user_id === actorId
        && event.resume_id === targetId && event.section_key === "introduction")).toBe(true);
    }

    // Same request/digest arrives from two independently minted sessions; the row lock serializes the RPCs.
    const sameRequestItems = (await readItems()).map(({ id, zh, en }) => ({ id, zh: `${zh} same-request`, en }));
    const sameRequestId = localUuid();
    const [sessionA, sessionB] = await Promise.all([sessionToken(localUuid()), sessionToken(localUuid())]);
    const beforeSameRequestEvents = (await readEvents()).length;
    const sameRequestResults = await runWithTwoDatabaseSessionsBlocked(targetId, () => Promise.all([
      invoke(sameRequestItems, sameRequestId, sessionA),
      invoke(sameRequestItems, sameRequestId, sessionB),
    ]));
    expect(sameRequestResults.map(({ response }) => response.status)).toEqual([200, 200]);
    expect(sameRequestResults[0].body).toEqual(sameRequestResults[1].body);
    const afterSameRequestEvents = await readEvents();
    expect(afterSameRequestEvents.length).toBe(beforeSameRequestEvents + 1);
    expect(afterSameRequestEvents[0]).toMatchObject({ actor_user_id: actorId, resume_id: targetId, section_key: "introduction" });

    // Request-id scope includes both actor and target. Owner and QA can both
    // reach this local QA fixture; the same UUID with a different digest must
    // therefore be independent for the two synthetic actors.
    const sharedActorRequest = localUuid();
    const qaMutation = (await readItems()).map(({ id, zh, en }) => ({ id, zh: `${zh} QA actor`, en }));
    const ownerMutation = (await readItems()).map(({ id, zh, en }) => ({ id, zh, en: `${en} owner actor` }));
    const qaActorSave = await invoke(qaMutation, sharedActorRequest, userJwt!);
    const ownerActorSave = await invoke(ownerMutation, sharedActorRequest, ownerJwt!);
    expect(qaActorSave.response.status).toBe(200);
    expect(ownerActorSave.response.status).toBe(200);
    expect((await readItems()).map(({ en }) => en)).toEqual(ownerMutation.map(({ en }) => en));

    // The same actor/request ID against the QA and official-like local target
    // must not collide because target is another idempotency scope component.
    const sharedTargetRequest = localUuid();
    const ownerQaMutation = (await readItems()).map(({ id, zh, en }) => ({ id, zh: `${zh} owner QA`, en }));
    const ownerOfficialMutation = (await readItems(officialId, ownerJwt!)).map(({ id, zh, en }) => ({ id, zh, en: `${en} owner official` }));
    const ownerQaSave = await invoke(ownerQaMutation, sharedTargetRequest, ownerJwt!);
    const ownerOfficialSave = await invoke(ownerOfficialMutation, sharedTargetRequest, ownerJwt!, officialId);
    expect(ownerQaSave.response.status).toBe(200);
    expect(ownerOfficialSave.response.status).toBe(200);
    expect((await readEvents(targetId, ownerJwt!)).some((row) => row.actor_user_id === ownerId)).toBe(true);
  });

  it("integrates Awards Worker saves with local PostgREST/RPC, replay, conflict, no-op, rollback, and RLS", async () => {
    assertLocalConfiguration();
    const officialBefore = await readAwards(officialId, ownerJwt!);
    const initialState = await rest("/rest/v1/rpc/load_admin_awards_write_state", {
      method: "POST", body: JSON.stringify({ target_resume_id: targetId }),
    }) as Array<{ awards_write_mode: string; activity_log_enabled: boolean; awards_trusted_context_required: boolean }>;
    expect(initialState).toEqual([{ resume_id: targetId, awards_write_mode: "direct", activity_log_enabled: true, awards_trusted_context_required: false }]);

    // This opt-in harness mutates only its isolated local QA fixture. Its launcher
    // resets the local Supabase database after the integration process exits.
    localSql(`UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='${targetId}'::uuid AND domain_key='awards';
      INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
      VALUES ('${targetId}'::uuid,'awards','trusted_network_context_v11',true)
      ON CONFLICT (resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true`);
    const rpcState = await rest("/rest/v1/rpc/load_admin_awards_write_state", {
      method: "POST", body: JSON.stringify({ target_resume_id: targetId }),
    }) as Array<{ awards_write_mode: string; activity_log_enabled: boolean; awards_trusted_context_required: boolean }>;
    expect(rpcState).toEqual([{ resume_id: targetId, awards_write_mode: "rpc", activity_log_enabled: true, awards_trusted_context_required: true }]);

    const baseline = await readAwards();
    expect(baseline).toHaveLength(2);
    const eventsBefore = await readUnifiedEvents();
    const directWrite = await originalFetch(`${apiBase}/rest/v1/resume_award_entries`, {
      method: "POST", headers: { apikey: publishableKey!, Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ resume_id: targetId, position: 20, source_key: null }),
    });
    expect(directWrite.ok).toBe(false);

    const requestId = localUuid();
    const mixedSave = [
      { ...baseline[1], position: 0 },
      { ...baseline[0], position: 1, zh: { ...baseline[0].zh, name: `${baseline[0].zh.name} translation edit` } },
      { id: null, position: 2, zh: { name: "Synthetic local creation", year: "2099" }, en: { name: "Synthetic local creation", year: "2099" } },
    ];
    dropNextAwardsRpcResponseAfterCommit = true;
    const lostResponse = await invokeAwards(mixedSave, requestId);
    expect(lostResponse.response.status, JSON.stringify({ rpc: lastAwardsRpcFailure, worker: lostResponse.body })).toBe(502);
    const committedOnce = await readAwards();
    expect(committedOnce).toHaveLength(3);
    expect(committedOnce.map(({ position }) => position)).toEqual([0, 1, 2]);
    expect(committedOnce[0].id).toBe(baseline[1].id);
    expect(committedOnce[1].zh.name).toBe(`${baseline[0].zh.name} translation edit`);
    expect(committedOnce[2].id).toMatch(/^[0-9a-f-]{36}$/);
    const eventAfterFirst = await readUnifiedEvents();
    expect(eventAfterFirst).toHaveLength(eventsBefore.length + 1);
    expect(eventAfterFirst[0]).toMatchObject({ event_source: "activity", section_key: "awards", entity_type: "award_list", entity_id: null, payload_version: 2 });
    expect(eventAfterFirst[0].changes).toMatchObject({ awards: { before: baseline, after: committedOnce } });

    const replay = await invokeAwards(mixedSave, requestId);
    expect(replay.response.status).toBe(200);
    expect(replay.body).toMatchObject(committedOnce);
    expect(await readUnifiedEvents()).toHaveLength(eventsBefore.length + 1);
    const conflicting = mixedSave.map((item, index) => index === 0 ? { ...item, en: { ...item.en, name: "different payload" } } : item);
    const conflict = await invokeAwards(conflicting, requestId);
    expect(conflict.response.status).toBe(409);
    expect(await readAwards()).toEqual(committedOnce);
    expect(await readUnifiedEvents()).toHaveLength(eventsBefore.length + 1);

    const tampered = await invokeAwards(mixedSave, localUuid(), undefined, targetId, payload => ({
      ...payload, canonical_awards: `${String(payload.canonical_awards)} `,
    }));
    expect(tampered.response.ok).toBe(false);
    expect(await readAwards()).toEqual(committedOnce);
    expect(await readUnifiedEvents()).toHaveLength(eventsBefore.length + 1);

    const noOp = await invokeAwards(committedOnce.map(({ id, position, zh, en }) => ({ id, position, zh, en })));
    expect(noOp.response.status).toBe(200);
    expect(await readUnifiedEvents()).toHaveLength(eventsBefore.length + 1);

    const deleteAndReorder = [
      { ...committedOnce[2], position: 0 },
      { ...committedOnce[0], position: 1 },
    ];
    const secondChangedSave = await invokeAwards(deleteAndReorder);
    expect(secondChangedSave.response.status).toBe(200);
    const committedTwice = await readAwards();
    expect(committedTwice.map(row => row.id)).toEqual([committedOnce[2].id, committedOnce[0].id]);
    expect(await readUnifiedEvents()).toHaveLength(eventsBefore.length + 2);

    const concurrentRequestId = localUuid();
    const concurrentPayload = committedTwice.map((item, position) => ({ ...item, position,
      en: { ...item.en, year: `${item.en.year} concurrent` } }));
    const beforeConcurrentEvents = await readUnifiedEvents();
    const concurrentResults = await runWithTwoDatabaseSessionsBlocked(targetId, () => Promise.all([
      invokeAwards(concurrentPayload, concurrentRequestId), invokeAwards(concurrentPayload, concurrentRequestId),
    ]), "save_resume_awards_v1");
    expect(concurrentResults.map(result => result.response.status)).toEqual([200, 200]);
    expect(concurrentResults[0].body).toEqual(concurrentResults[1].body);
    expect(await readUnifiedEvents()).toHaveLength(beforeConcurrentEvents.length + 1);
    const committedConcurrent = await readAwards();

    localSql(`CREATE FUNCTION public.test_only_fail_awards_audit_insert() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
      BEGIN IF NEW.payload_version=2 THEN RAISE EXCEPTION 'TEST ONLY Awards audit rollback'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_only_fail_awards_audit_insert BEFORE INSERT ON cms_private.activity_log_events
      FOR EACH ROW EXECUTE FUNCTION public.test_only_fail_awards_audit_insert()`);
    try {
      const shouldRollback = committedConcurrent.map((item, position) => ({ ...item, position,
        en: { ...item.en, year: `${item.en.year} rollback` } }));
      const rollback = await invokeAwards(shouldRollback);
      expect(rollback.response.ok).toBe(false);
      expect(await readAwards()).toEqual(committedConcurrent);
      expect(await readUnifiedEvents()).toHaveLength(eventsBefore.length + 3);
    } finally {
      localSql("DROP TRIGGER IF EXISTS test_only_fail_awards_audit_insert ON cms_private.activity_log_events; DROP FUNCTION IF EXISTS public.test_only_fail_awards_audit_insert()");
    }

    const crossTarget = await invokeAwards(committedTwice.map(({ id, position, zh, en }) => ({ id, position, zh, en })), localUuid(), userJwt!, officialId);
    expect(crossTarget.response.ok).toBe(false);
    expect(await readAwards(officialId, ownerJwt!)).toEqual(officialBefore);
  });

  const contextMutation = (change: (context: Record<string, unknown>) => void) => (payload: Record<string, unknown>) => {
    const context = JSON.parse(String(payload.signed_context)) as Record<string, unknown>;
    change(context);
    return { ...payload, signed_context: JSON.stringify(context) };
  };
  const awardsAdversarialCases: Array<{ name: string; mutate: (payload: Record<string, unknown>) => Record<string, unknown> }> = [
    { name: "actor/authenticated-user binding", mutate: contextMutation(context => { context.actor_user_id = ownerId; }) },
    { name: "target resume binding", mutate: contextMutation(context => { context.resume_id = officialId; }) },
    { name: "domain binding", mutate: contextMutation(context => { context.domain = "introduction"; }) },
    { name: "operation binding", mutate: contextMutation(context => { context.operation = "delete"; }) },
    { name: "request_id binding", mutate: contextMutation(context => { context.request_id = "20000000-0000-4000-8000-000000000099"; }) },
    { name: "mutation digest binding", mutate: contextMutation(context => { context.mutation_digest = "f".repeat(64); }) },
    { name: "canonical payload digest binding", mutate: payload => ({ ...payload, canonical_awards: `${String(payload.canonical_awards)} ` }) },
    { name: "issued timestamp future bound", mutate: contextMutation(context => {
      const issued = Math.floor(Date.now() / 1000) + 120; context.issued_at = issued; context.expires_at = issued + 180;
    }) },
    { name: "expired context", mutate: contextMutation(context => {
      const issued = Math.floor(Date.now() / 1000) - 600; context.issued_at = issued; context.expires_at = issued + 300;
    }) },
    { name: "expiry maximum lifetime", mutate: contextMutation(context => {
      const issued = Math.floor(Date.now() / 1000) - 10; context.issued_at = issued; context.expires_at = issued + 301;
    }) },
    { name: "signature_hex integrity", mutate: payload => {
      const signature = String(payload.signature_hex);
      return { ...payload, signature_hex: `${signature.startsWith("0") ? "1" : "0"}${signature.slice(1)}` };
    } },
    { name: "key ID allowlist", mutate: contextMutation(context => { context.key_id = "activity_log_v11_wrong_key"; }) },
    { name: "required signed network-context fields", mutate: contextMutation(context => { delete context.city; }) },
  ];

  it.each(awardsAdversarialCases)("rejects independently tampered Awards $name before content or audit writes", async ({ mutate }) => {
    assertLocalConfiguration();
    localSql(`UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='${targetId}'::uuid AND domain_key='awards';
      INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
      VALUES ('${targetId}'::uuid,'awards','trusted_network_context_v11',true)
      ON CONFLICT (resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true`);
    const beforeAwards = await readAwards();
    const beforeEvents = await readUnifiedEvents();
    const beforeEventCount = localSql(`SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id='${targetId}'::uuid AND section_key='awards' AND payload_version=2`);
    const beforeSystemCount = localSql(`SELECT count(*) FROM cms_private.activity_log_system_events WHERE resume_id='${targetId}'::uuid`);
    const recorderCount = v13RecorderBodies.length;
    const requestId = localUuid();
    const changedPayload = beforeAwards.map(({ id, position, zh, en }, index) => ({ id, position,
      zh: { ...zh, name: index === 0 ? `${zh.name} rejected probe` : zh.name }, en }));

    const result = await invokeAwards(changedPayload, requestId, userJwt!, targetId, mutate);
    expect(result.response.ok).toBe(false);
    expect(lastAwardsRpcFailure).toMatchObject({ status: 400, code: "22023" });
    expect(await readAwards()).toEqual(beforeAwards);
    expect(await readUnifiedEvents()).toEqual(beforeEvents);
    expect(localSql(`SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id='${targetId}'::uuid AND section_key='awards' AND payload_version=2`)).toBe(beforeEventCount);
    expect(localSql(`SELECT count(*) FROM cms_private.activity_log_system_events WHERE resume_id='${targetId}'::uuid`)).toBe(beforeSystemCount);
    expect(localSql(`SELECT count(*) FROM cms_private.activity_log_idempotency WHERE actor_user_id='${actorId}'::uuid AND resume_id='${targetId}'::uuid AND domain_key='awards' AND request_id='${requestId}'::uuid`)).toBe("0");
    expect(v13RecorderBodies).toHaveLength(recorderCount);
  });

  it("integrates Projects state/read and signed Worker → PostgREST → RPC save, exact replay, and conflict", async () => {
    assertLocalConfiguration();
    const baseline = await readProjects();
    expect(baseline.length).toBeGreaterThan(0);
    const beforeEvents = await readUnifiedEvents();
    const directState = await readProjectsWriteState();
    expect(directState).toHaveLength(1);
    expect(directState[0]).toMatchObject({ resume_id: targetId, projects_write_mode: "direct" });

    localSql(`UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='${targetId}'::uuid AND domain_key='projects';
      INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
      VALUES ('${targetId}'::uuid,'projects','trusted_network_context_v11',true)
      ON CONFLICT (resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true`);
    try {
      const writeState = await readProjectsWriteState();
      expect(writeState[0]).toMatchObject({ resume_id: targetId, projects_write_mode: "rpc", projects_trusted_context_required: true });
      const toRequest = (items: LocalProject[]) => items.map(({ id, position, zh, en, methods }) => ({
        id, position, zh, en,
        methods: { zh: methods.zh.map(({ id: methodId, position: methodPosition, value }) => ({ id: methodId, position: methodPosition, value })),
          en: methods.en.map(({ id: methodId, position: methodPosition, value }) => ({ id: methodId, position: methodPosition, value })) },
      }));

      const noOp = await invokeProjects(toRequest(baseline));
      expect(noOp.response.status).toBe(200);
      expect(await readProjects()).toEqual(baseline);
      expect(await readUnifiedEvents()).toHaveLength(beforeEvents.length);

      const changed = structuredClone(baseline);
      changed[0]!.zh.title = `${changed[0]!.zh.title} integration check`;
      const requestId = localUuid();
      const first = await invokeProjects(toRequest(changed), requestId);
      expect(first.response.status).toBe(200);
      expect(Array.isArray(first.body)).toBe(true);
      const committed = await readProjects();
      expect(committed[0]!.zh.title).toBe(changed[0]!.zh.title);
      expect(committed.map(({ id, source_key }) => [id, source_key])).toEqual(baseline.map(({ id, source_key }) => [id, source_key]));
      expect(committed.flatMap(project => [...project.methods.zh, ...project.methods.en].map(({ id }) => id)))
        .toEqual(baseline.flatMap(project => [...project.methods.zh, ...project.methods.en].map(({ id }) => id)));
      const afterFirst = await readUnifiedEvents();
      expect(afterFirst).toHaveLength(beforeEvents.length + 1);
      expect(afterFirst[0]).toMatchObject({ resume_id: targetId, section_key: "projects", entity_type: "project_list", entity_id: null, operation: "update", payload_version: 2 });

      const replay = await invokeProjects(toRequest(changed), requestId);
      expect(replay.response.status).toBe(200);
      expect(replay.body).toEqual(first.body);
      expect(await readProjects()).toEqual(committed);
      expect(await readUnifiedEvents()).toHaveLength(beforeEvents.length + 1);

      const conflicting = structuredClone(changed);
      conflicting[0]!.en.title = `${conflicting[0]!.en.title} conflict`;
      const conflict = await invokeProjects(toRequest(conflicting), requestId);
      expect(conflict.response.status).toBe(409);
      expect(conflict.body).toMatchObject({ error: { code: "idempotency_conflict" } });
      expect(await readProjects()).toEqual(committed);
      expect(await readUnifiedEvents()).toHaveLength(beforeEvents.length + 1);
    } finally {
      localSql(`UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id='${targetId}'::uuid AND domain_key='projects';
        DELETE FROM cms_private.resume_domain_requirements WHERE resume_id='${targetId}'::uuid AND domain_key='projects' AND requirement_key='trusted_network_context_v11'`);
    }
  });

  it("accepts a valid request at the 4096-byte canonical boundary and stores a result within 8192 bytes", async () => {
    assertLocalConfiguration();
    localSql(`UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='${targetId}'::uuid AND domain_key='awards';
      INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
      VALUES ('${targetId}'::uuid,'awards','trusted_network_context_v11',true)
      ON CONFLICT (resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true`);
    const payload = nearLimitAwards();
    const canonicalBytes = new TextEncoder().encode(canonicalizeAwards(payload)).byteLength;
    expect(canonicalBytes).toBe(4096);
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.length).toBeLessThanOrEqual(32);
    const beforeEvents = await readUnifiedEvents();
    const requestId = localUuid();
    const result = await invokeAwards(payload, requestId);
    expect(result.response.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    const stored = localSql(`SELECT octet_length(result_payload::text) || ':' || (completed_at IS NOT NULL)::text
      FROM cms_private.activity_log_idempotency WHERE actor_user_id='${actorId}'::uuid AND resume_id='${targetId}'::uuid AND domain_key='awards' AND request_id='${requestId}'::uuid`);
    const [resultBytes, completed] = stored.split(":");
    expect(Number(resultBytes)).toBeLessThanOrEqual(8192);
    expect(completed).toBe("true");
    expect(await readUnifiedEvents()).toHaveLength(beforeEvents.length + 1);
  });
});
