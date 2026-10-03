// TEST ONLY: end-to-end frozen Worker -> local PostgREST -> frozen RPC coverage.
// Run through run-v11-local-integration.mjs after the documented local db reset.
import { afterAll, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const enabled = process.env.V11_LOCAL_INTEGRATION === "1";
const apiBase = process.env.V11_LOCAL_API_URL;
const workerSupabaseUrl = process.env.V11_LOCAL_WORKER_SUPABASE_URL;
const publishableKey = process.env.V11_LOCAL_PUBLISHABLE_KEY;
const userJwt = process.env.V11_LOCAL_USER_JWT;
const ownerJwt = process.env.V11_LOCAL_OWNER_JWT;
const testKeyHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const targetId = "ea111111-1111-4111-8111-111111111111";
const officialId = "20000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const ownerId = "10000000-0000-4000-8000-000000000001";
const dbContainer = "supabase_db_example-cv-admin-rls-local-test";
const originalFetch = globalThis.fetch;
const expectedLocalApiOrigin = "http://127.0.0.1:55421";
const workerUpstreamOrigin = "https://local.supabase.invalid";
const localUuid = randomUUID;

if (enabled) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.origin !== workerUpstreamOrigin) throw new Error("Local integration refused a non-fixture Worker upstream");
    url.protocol = "http:";
    url.hostname = "127.0.0.1";
    url.port = "55421";
    return originalFetch(url, init);
  }) as typeof fetch;
}

function assertLocalConfiguration(): void {
  if (!apiBase || new URL(apiBase).origin !== expectedLocalApiOrigin
    || !workerSupabaseUrl || new URL(workerSupabaseUrl).origin !== "https://local.supabase.invalid"
    || !publishableKey || !userJwt || !ownerJwt) {
    throw new Error("Local V1.1 integration environment is incomplete or not loopback-only");
  }
}

function workerEnv(): WorkerEnv {
  assertLocalConfiguration();
  return {
    ASSETS: { fetch: async () => new Response("not used", { status: 404 }) },
    SUPABASE_URL: workerSupabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    ACTIVITY_LOG_HMAC_KEY_ID: "local-test-v1",
    ACTIVITY_LOG_HMAC_KEY: testKeyHex,
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

function localSql(sql: string): string {
  return execFileSync("docker", ["exec", dbContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim().split(/\r?\n/, 1)[0];
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

async function invoke(items: Array<{ id: string | null; zh: string; en: string }>, requestId?: string, token?: string, target = targetId, clientIp?: string): Promise<{ response: Response; body: unknown }> {
  const response = await handleWorkerRequest(makeRequest(items, requestId, token, target, clientIp), workerEnv());
  return { response, body: await response.json() };
}

function rpcRows(body: unknown): Array<{ id: string; position: number; translations: { zh: { text: string }; en: { text: string } } }> {
  if (!Array.isArray(body)) throw new Error("Worker returned a non-array canonical Introduction result");
  return body as ReturnType<typeof rpcRows>;
}

async function runWithTwoDatabaseSessionsBlocked<T>(target: string, operation: () => Promise<T>): Promise<T> {
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
        "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%save_resume_introduction_v11%'"], { encoding: "utf8" }).trim();
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
    const ordered = [...baseline].reverse();
    const added = { id: `local-${Date.now()}-0`, zh: "D integration local item", en: "D integration local item" };
    const requested = [...ordered.map(({ id, zh, en }) => ({ id, zh, en })), added];
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
});
