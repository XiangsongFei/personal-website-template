// @vitest-environment node
// Candidate matrix only. Synthetic data, real local PostgREST, actual Worker code.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const enabled = process.env.COMPAT_MATRIX === "1";
const newDb = process.env.COMPAT_DB === "new";
const newWorker = process.env.COMPAT_WORKER === "new";
const target = "ea111111-1111-4111-8111-111111111111";
const actor = "10000000-0000-4000-8000-000000000002";
const owner = "10000000-0000-4000-8000-000000000001";
const upstream = "https://local.supabase.invalid";
const rawFetch = globalThis.fetch;
let worker: typeof handleWorkerRequest;
let jwt = "", key = "", secret = "", modes = "", requirements = "";
let lastRpcCode = "", lastRpcPath = "", drop = false, tamper = false;
function retainedRequest(domain: string, body?: Record<string, unknown>): Record<string, unknown> | undefined {
  const file = process.env.COMPAT_PENDING_FILE ?? "";
  const pendingPath = /^\/(?:[A-Za-z0-9_-]+\/)*pr1-supabase-([0-9]+-[a-f0-9]{12})-[A-Za-z0-9]{6}\/candidate-pending\.json$/.exec(file);
  if (!pendingPath || `supabase_db_pr1-${pendingPath[1]}` !== process.env.COMPAT_DB_CONTAINER) throw new Error("unsafe pending fixture");
  const records = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (body) { records[domain] = body; writeFileSync(file, JSON.stringify(records)); }
  return records[domain];
}
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
function sql(query: string) {
  const db = process.env.COMPAT_DB_CONTAINER ?? "";
  if (!/^supabase_db_pr1-[0-9]+-[a-f0-9]+$/.test(db)) throw new Error("unsafe fixture identity");
  const r = spawnSync("docker", ["exec", "-i", db, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    { input: query, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("fixture SQL failed");
  return r.stdout.trim();
}
function token(id: string, role = "authenticated") {
  const now = Math.floor(Date.now() / 1000);
  const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const text = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role, aud: "authenticated", iss: "local-test", iat: now, exp: now + 3600, email: "synthetic@example.invalid", session_id: randomUUID() })}`;
  return `${text}.${createHmac("sha256", secret).update(text).digest("base64url")}`;
}
async function rest(path: string, body: unknown) {
  const r = await rawFetch(`${process.env.COMPAT_API}/rest/v1/rpc/${path}`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  expect(r.status).toBe(200);
  return r.json();
}
async function invoke(domain: string, body: Record<string, unknown>, bearer = jwt) {
  lastRpcCode = ""; lastRpcPath = "";
  const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, SUPABASE_URL: upstream, SUPABASE_PUBLISHABLE_KEY: key,
    ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1", ACTIVITY_LOG_HMAC_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    ACTIVITY_LOG_V13_HMAC_KEY: "a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7" } as WorkerEnv;
  const r = await worker(new Request(`https://admin.local.test/api/admin/v1/${domain}/save`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}
function counts(domain: string) {
  const tables: Record<string, string[]> = { awards: ["resume_award_entries", "resume_award_translations"], skills: ["resume_skill_groups", "resume_skill_group_translations"], section_titles: ["resume_locale_content"] };
  if (!tables[domain]) throw new Error("unknown domain");
  const data = tables[domain].map(table => `(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM public.${table} t WHERE resume_id='${target}')`).join(",");
  return sql(`SELECT jsonb_build_array((SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id='${target}' AND section_key=${q(domain)}),(SELECT count(*) FROM cms_private.activity_log_idempotency WHERE resume_id='${target}' AND domain_key=${q(domain)}),md5(jsonb_build_array(${data})::text))::text;`);
}
function exactlyOneWrite(before: string, after: string) {
  const a = JSON.parse(before), b = JSON.parse(after);
  expect(b[0]).toBe(a[0] + 1); expect(b[1]).toBe(a[1] + 1); expect(b[2]).not.toBe(a[2]);
}
async function baseline(domain: string) {
  if (!newDb || !newWorker) return { expected_baseline_digest: "0".repeat(64), baseline_proof: "0".repeat(64) };
  const rows = await rest(`load_admin_${domain}_write_state`, { target_resume_id: target });
  return { expected_baseline_digest: rows[0][`${domain}_baseline_digest`] as string, baseline_proof: rows[0][`${domain}_baseline_proof`] as string };
}
function verifyRejection(result: { status: number }, domain: string, before: string, code: string) {
  expect(result.status).toBe(422);
  expect(lastRpcPath).toBe(`/rest/v1/rpc/save_resume_${domain}_v1`);
  expect(lastRpcCode).toBe(code);
  expect(counts(domain)).toBe(before);
}

beforeAll(async () => {
  if (!enabled) return;
  if (!["old", "new"].includes(process.env.COMPAT_DB ?? "") || !["old", "new"].includes(process.env.COMPAT_WORKER ?? "")
    || new URL(process.env.COMPAT_API ?? "").hostname !== "127.0.0.1") throw new Error("unsafe matrix environment");
  const auth = process.env.COMPAT_AUTH_CONTAINER ?? "";
  if (!/^supabase_auth_pr1-[0-9]+-[a-f0-9]+$/.test(auth)) throw new Error("unsafe Auth identity");
  const inspected = spawnSync("docker", ["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", auth], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (inspected.status !== 0) throw new Error("local Auth unavailable");
  secret = inspected.stdout.split(/\r?\n/).find(x => x.startsWith("GOTRUE_JWT_SECRET="))?.slice(18) ?? "";
  if (!secret) throw new Error("local signer unavailable");
  jwt = token(actor); key = token(actor, "anon");
  if (newWorker) worker = handleWorkerRequest;
  else {
    const path = process.env.COMPAT_OLD_BUNDLE ?? "";
    const workerPath = /^file:\/\/\/(?:[A-Za-z0-9_-]+\/)*pr1-supabase-([0-9]+-[a-f0-9]{12})-[A-Za-z0-9]{6}\/candidate-worker\.mjs$/.exec(path);
    if (!workerPath || `supabase_db_pr1-${workerPath[1]}` !== process.env.COMPAT_DB_CONTAINER) throw new Error("unsafe candidate source");
    worker = (await import(/* @vite-ignore */ path)).handleWorkerRequest;
  }
  expect(sql(`SELECT count(*) FROM public.resume_sites s JOIN public.cms_admins a ON a.resume_id=s.id WHERE s.id='${target}' AND s.site_key='example-cv-qa-activity-log' AND NOT s.is_published AND a.user_id='${actor}' AND a.role='qa'`)).toBe("1");
  modes = sql(`SELECT COALESCE(jsonb_agg(to_jsonb(m)),'[]')::text FROM cms_private.resume_write_modes m WHERE resume_id='${target}'`);
  requirements = sql(`SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]')::text FROM cms_private.resume_domain_requirements r WHERE resume_id='${target}'`);
  if (newDb) {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await rawFetch(`${process.env.COMPAT_API}/rest/v1/rpc/load_admin_section_titles_write_state`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ target_resume_id: target }), signal: AbortSignal.timeout(2000) });
      const rows = await response.json();
      if (response.ok && Array.isArray(rows) && typeof rows[0]?.section_titles_baseline_digest === "string") { ready = true; break; }
      await wait(250);
    }
    expect(ready).toBe(true);
  }
  // Explicit synthetic protocol preconditions, never part of structural migrations.
  const domains = newDb ? ["awards", "skills", "section_titles"] : ["awards", "skills"];
  for (const domain of domains) sql(`INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode) VALUES('${target}',${q(domain)},'rpc') ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='rpc'; INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled) VALUES('${target}',${q(domain)},'trusted_network_context_v11',true) ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;`);
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.origin !== upstream) throw new Error("non-fixture upstream refused");
    const local = new URL(process.env.COMPAT_API!);
    url.protocol = local.protocol; url.hostname = local.hostname; url.port = local.port;
    let forwarded = init;
    if (url.pathname.startsWith("/rest/v1/rpc/save_resume_") && typeof init?.body === "string") {
      lastRpcPath = url.pathname;
      if (tamper) { tamper = false; const b = JSON.parse(init.body); b.signature_hex = "0".repeat(64); forwarded = { ...init, body: JSON.stringify(b) }; }
    }
    const response = await rawFetch(url, { ...forwarded, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { const body = await response.clone().json().catch(() => ({})); lastRpcCode = typeof body.code === "string" ? body.code : ""; }
    if (drop && response.ok && url.pathname.startsWith("/rest/v1/rpc/save_resume_")) { drop = false; return Response.json({}, { status: 503 }); }
    return response;
  };
}, 60_000);

afterAll(() => {
  globalThis.fetch = rawFetch;
  if (!enabled || !modes || !requirements) return;
  sql(`BEGIN; DELETE FROM cms_private.resume_write_modes WHERE resume_id='${target}'; INSERT INTO cms_private.resume_write_modes SELECT * FROM jsonb_populate_recordset(NULL::cms_private.resume_write_modes,${q(modes)}::jsonb); DELETE FROM cms_private.resume_domain_requirements WHERE resume_id='${target}'; INSERT INTO cms_private.resume_domain_requirements SELECT * FROM jsonb_populate_recordset(NULL::cms_private.resume_domain_requirements,${q(requirements)}::jsonb); COMMIT;`);
});

describe.skipIf(!enabled)("candidate compatibility", () => {
  it("awards", async () => {
    const awards = [{ id: null, position: 0, zh: { name: "合成", year: "2026" }, en: { name: "Synthetic", year: "2026" } }];
    const body = { request_id: randomUUID(), resume_id: target, awards, ...(newWorker ? await baseline("awards") : {}) };
    const before = counts("awards");
    const retained = retainedRequest("awards");
    if (newWorker && retained) {
      expect((await invoke("awards", retained)).status).toBe(400);
      expect(counts("awards")).toBe(before);
      expect(retainedRequest("awards")).toEqual(retained);
    }
    const result = await invoke("awards", body);
    if (newDb !== newWorker) { verifyRejection(result, "awards", before, "PGRST202"); return; }
    expect(result.status).toBe(200);
    const saved = counts("awards"); exactlyOneWrite(before, saved);
    if (!newDb && !newWorker) retainedRequest("awards", body);
    expect(await invoke("awards", body)).toEqual(result); expect(counts("awards")).toBe(saved);
    expect((await invoke("awards", { ...body, awards: [{ ...awards[0], en: { name: "Changed", year: "2026" } }] })).status).toBe(409);
    expect(counts("awards")).toBe(saved);
    if (newDb) {
      const fresh = { ...body, request_id: randomUUID(), ...(await baseline("awards")) };
      drop = true;
      expect((await invoke("awards", fresh)).status).toBe(502);
      const committed = counts("awards");
      expect((await invoke("awards", fresh)).status).toBe(200);
      expect(counts("awards")).toBe(committed);
    }
  });
  it("skills", async () => {
    const skills = [{ id: null, position: 0, zh: { title: "合成", items: "SQL" }, en: { title: "Synthetic", items: "SQL" } }];
    const body = { request_id: randomUUID(), resume_id: target, skills, ...(newWorker ? await baseline("skills") : {}) };
    const before = counts("skills");
    const retained = retainedRequest("skills");
    if (newWorker && retained) {
      expect((await invoke("skills", retained)).status).toBe(400);
      expect(counts("skills")).toBe(before);
      expect(retainedRequest("skills")).toEqual(retained);
    }
    const result = await invoke("skills", body);
    if (newDb !== newWorker) { verifyRejection(result, "skills", before, "22023"); return; }
    expect(result.status).toBe(200);
    const saved = counts("skills"); exactlyOneWrite(before, saved);
    if (!newDb && !newWorker) retainedRequest("skills", body);
    expect(await invoke("skills", body)).toEqual(result); expect(counts("skills")).toBe(saved);
    tamper = true;
    expect((await invoke("skills", { ...body, request_id: randomUUID() })).status).toBe(422);
    expect(counts("skills")).toBe(saved);
    if (newDb) {
      expect((await invoke("skills", { ...body, request_id: randomUUID() })).status).toBe(409);
      expect(counts("skills")).toBe(saved);
      const fresh = { ...body, request_id: randomUUID(), ...(await baseline("skills")) };
      sql(`CREATE FUNCTION public.compatibility_fail_audit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='XX000'; END $$;
        REVOKE ALL ON FUNCTION public.compatibility_fail_audit() FROM PUBLIC;
        CREATE TRIGGER compatibility_fail_audit BEFORE INSERT ON cms_private.activity_log_events FOR EACH ROW EXECUTE FUNCTION public.compatibility_fail_audit();`);
      try { expect((await invoke("skills", fresh)).status).toBe(502); expect(counts("skills")).toBe(saved); }
      finally { sql("DROP TRIGGER compatibility_fail_audit ON cms_private.activity_log_events; DROP FUNCTION public.compatibility_fail_audit();"); }
    }
  });
  it("section-titles", async () => {
    const fields = ["education_label", "experience_label", "skills_label", "honors_label", "project_heading", "kaggle_label"];
    const section_titles = { translations: { zh: Object.fromEntries(fields.map(x => [x, "合成标题"])), en: Object.fromEntries(fields.map(x => [x, "Synthetic title"])) } };
    const body = { request_id: randomUUID(), resume_id: target, section_titles, ...(await baseline("section_titles")) };
    const before = counts("section_titles");
    if (!newWorker) { expect((await invoke("section-titles", body)).status).toBe(404); expect(counts("section_titles")).toBe(before); return; }
    if (!newDb) { verifyRejection(await invoke("section-titles", body), "section_titles", before, "PGRST202"); return; }
    drop = true;
    expect((await invoke("section-titles", body)).status).toBe(502);
    const committed = counts("section_titles"); exactlyOneWrite(before, committed);
    expect((await baseline("section_titles")).expected_baseline_digest).not.toBe(body.expected_baseline_digest);
    const replay = await invoke("section-titles", body);
    expect(replay.status).toBe(200); expect(replay.body.section_titles).toEqual(section_titles);
    expect(counts("section_titles")).toBe(committed);
    expect((await invoke("section-titles", body, token(owner))).status).toBe(422);
    expect(counts("section_titles")).toBe(committed);
    expect((await invoke("section-titles", { ...body, request_id: randomUUID() })).status).toBe(409);
    expect(counts("section_titles")).toBe(committed);
  });
  it("files-reference", () => {
    const allowed = (site: string, path: string, locale = "en") => sql(`SELECT cms_private.files_historical_reference_is_allowed('${upstream}','${target}',${q(site)},${q(locale)},${q(`${upstream}/storage/v1/object/public/resume-files/${path}`)})`);
    expect(allowed("example-cv-qa", `${target}/resume_en.pdf`)).toBe("t");
    expect(allowed("example-cv-qa-activity-log", `${target}/resume_en.pdf`)).toBe(newDb ? "t" : "f");
    expect(allowed("example-cv", "example-cv/resume_en.pdf")).toBe("t");
    for (const [site, path, locale] of [["unknown", `${target}/resume_en.pdf`, "en"], ["example-cv", `${target}/resume_en.pdf`, "en"], ["example-cv-qa", "example-cv/resume_en.pdf", "en"], ["example-cv-qa", `${target}/resume_en.pdf`, "zh"]]) expect(allowed(site, path, locale)).toBe("f");
    expect(sql("SELECT count(*) FROM cms_private.resume_capabilities WHERE capability_key='restore' AND enabled")).toBe("0");
  });
  it("authorization", async () => {
    const before = counts("awards");
    const body = { request_id: randomUUID(), resume_id: target, awards: [], ...(newWorker ? await baseline("awards") : {}) };
    const denied = await invoke("awards", body, token(owner));
    expect(denied.status).toBe(422);
    expect(counts("awards")).toBe(before);
    expect(sql(`SELECT public.can_manage_resume('${target}')`)).toBe("f");
  });
});
