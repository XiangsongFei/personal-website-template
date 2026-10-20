// TEST ONLY: injects credentials from the named local Supabase Auth container
// into one opt-in Vitest process. Nothing from this script is printed except
// the test result; no remote endpoint is accepted.
/* global Buffer, console, process */
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { setTimeout, clearTimeout } from "node:timers";
import assert from "node:assert/strict";
import { withStagedLocalSupabase } from "./rls-runtime/stage-local-supabase.mjs";

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetId = "ea111111-1111-4111-8111-111111111111";
const officialId = "20000000-0000-4000-8000-000000000001";
async function integration() {
await withStagedLocalSupabase(async (stage, supabase) => {
process.send?.({ kind: "stage", manifest: join(stage.stagedRoot, "ownership.json") });
process.send?.({ kind: "phase", value: "fixture-preflight" });
const authContainer = stage.authContainer;
const dbContainer = stage.dbContainer;
function psql(sql) {
  const result = spawnSync("docker", ["exec", dbContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-c", sql], { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Local-only test fixture SQL failed");
  return result.stdout.trim();
}
if (spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", dbContainer], { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 }).stdout.trim() !== "true") {
  throw new Error("The named local database container is not running");
}
const inspected = spawnSync("docker", ["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", authContainer], { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });
if (inspected.status !== 0) throw new Error("Required local Supabase Auth container is unavailable");
const jwtSecret = inspected.stdout.split(/\r?\n/).find((line) => line.startsWith("GOTRUE_JWT_SECRET="))?.slice("GOTRUE_JWT_SECRET=".length);
if (!jwtSecret) throw new Error("Local Supabase JWT signer is unavailable");
const priorRequirement = psql(`SELECT COALESCE((SELECT enabled::text FROM cms_private.resume_domain_requirements WHERE resume_id='${targetId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'),'absent')`);
if (!new Set(["absent", "true", "false"]).has(priorRequirement)) throw new Error("Unexpected local V1.1 requirement state");
const officialBaseline = psql(`SELECT cms_private.get_resume_write_mode('${officialId}'::uuid,'introduction') || ':' || COALESCE((SELECT enabled::text FROM cms_private.resume_capabilities WHERE resume_id='${officialId}'::uuid AND capability_key='activity_log'),'absent') || ':' || COALESCE((SELECT enabled::text FROM cms_private.resume_domain_requirements WHERE resume_id='${officialId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'),'absent')`);
if (officialBaseline !== "direct:absent:absent" && officialBaseline !== "direct:false:absent") throw new Error("Official-like local fixture is not in the expected direct/off baseline");

function token(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  return `${input}.${createHmac("sha256", jwtSecret).update(input).digest("base64url")}`;
}

const now = Math.floor(Date.now() / 1000);
process.send?.({ kind: "phase", value: "database-reset" });
supabase(["db", "reset", "--local"]);
process.send?.({ kind: "phase", value: "integration-tests" });
const childEnv = {
  ...process.env,
  V11_LOCAL_INTEGRATION: "1",
  V11_LOCAL_DB_CONTAINER: dbContainer,
  V11_LOCAL_API_URL: stage.apiUrl,
  V11_LOCAL_WORKER_SUPABASE_URL: "https://local.supabase.invalid",
  V11_LOCAL_PUBLISHABLE_KEY: token({ aud: "authenticated", role: "anon", iss: "local-test", iat: now, exp: now + 3600 }),
  V11_LOCAL_JWT_SECRET: jwtSecret,
  V11_LOCAL_USER_JWT: token({
    aud: "authenticated", role: "authenticated", iss: "local-test", iat: now, exp: now + 3600,
    sub: "10000000-0000-4000-8000-000000000002", email: "qa-local@example.invalid",
    session_id: randomUUID(), app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  }),
  V11_LOCAL_OWNER_JWT: token({
    aud: "authenticated", role: "authenticated", iss: "local-test", iat: now, exp: now + 3600,
    sub: "10000000-0000-4000-8000-000000000001", email: "owner-local@example.invalid",
    session_id: randomUUID(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
  }),
};
const vitest = resolve(adminRoot, "node_modules/.bin/vitest");
const reportPath = join(stage.stagedRoot, "v11-results.json");
const result = spawnSync(vitest, ["run", "tests/activity-log-v11-local-integration.test.ts", "--reporter=json", `--outputFile=${reportPath}`], {
  cwd: adminRoot, env: childEnv, stdio: "ignore", timeout: 300_000, killSignal: "SIGKILL",
});
let testSummary;
try {
  if (statSync(reportPath).size > 4 * 1024 * 1024) throw new Error("Result report exceeds limit");
  testSummary = summarizeResults(JSON.parse(readFileSync(reportPath, "utf8")));
}
catch { testSummary = null; }
process.send?.({ kind: "results", summary: testSummary });
process.send?.({ kind: "phase", value: "fixture-cleanup" });
let networkCheckPassed = false;
let cleanupPassed = true;
try {
  const networkVerified = psql(`WITH privacy_events AS (
    SELECT actor_user_id, operation, section_key, entity_type, entity_id, entity_snapshot,
      ip_network, country_code, region, city,
      CASE
        WHEN entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item","text_en":"D integration local item"}]}'::jsonb THEN 'ipv4-input'
        WHEN entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item IPv6","text_en":"D integration local item"}]}'::jsonb THEN 'ipv6-input'
      END AS input_case
    FROM cms_private.activity_log_events
    WHERE resume_id='${targetId}'::uuid
      AND site_key_snapshot='example-cv-qa'
      AND entity_type='introduction_paragraph'
      AND entity_id='introduction'
      AND (entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item","text_en":"D integration local item"}]}'::jsonb
        OR entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item IPv6","text_en":"D integration local item"}]}'::jsonb)
  )
  SELECT count(*) = 2
    AND count(*) FILTER (WHERE input_case='ipv4-input') = 1
    AND count(*) FILTER (WHERE input_case='ipv6-input') = 1
    AND bool_and(actor_user_id='10000000-0000-4000-8000-000000000002'::uuid AND operation='update'
      AND section_key='introduction' AND entity_type='introduction_paragraph' AND entity_id='introduction'
      AND ip_network IS NULL AND country_code IS NULL AND region IS NULL AND city IS NULL)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='cms_private.activity_log_events'::regclass
      AND attnum>0 AND NOT attisdropped AND attname ~* '(signature|hmac|secret|key_material|signed_context)')
  FROM privacy_events`);
  networkCheckPassed = networkVerified === "t";
} catch {
  networkCheckPassed = false;
}
try {
  if (priorRequirement === "absent") {
    psql(`DELETE FROM cms_private.resume_domain_requirements WHERE resume_id='${targetId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'`);
  } else {
    psql(`UPDATE cms_private.resume_domain_requirements SET enabled=${priorRequirement} WHERE resume_id='${targetId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'`);
  }
  psql(`DELETE FROM cms_private.resume_domain_requirements WHERE resume_id='${officialId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'; UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id='${officialId}'::uuid AND domain_key='introduction'; ${officialBaseline.endsWith(":absent:absent") ? `DELETE FROM cms_private.resume_capabilities WHERE resume_id='${officialId}'::uuid AND capability_key='activity_log'` : `UPDATE cms_private.resume_capabilities SET enabled=false WHERE resume_id='${officialId}'::uuid AND capability_key='activity_log'`}`);
} catch {
  cleanupPassed = false;
}
if (!networkCheckPassed) console.error("Local Worker network-context persistence check failed.");
if (!cleanupPassed) console.error("Local requirement cleanup failed; the isolated project will be removed after ownership verification.");
if (!cleanupPassed) throw new Error("Local integration fixture cleanup failed");
if (!networkCheckPassed) throw new Error("Local Worker network-context persistence check failed");
if (result.status !== 0 || !testSummary?.passed) throw new Error("Local Worker integration tests did not all execute and pass");
});

}

// Only fixed statuses and bounded counts leave the disposable child process.
function summarizeResults(report) {
  const suites = report?.testResults;
  if (!Array.isArray(suites) || suites.length !== 1 || !Array.isArray(suites[0].assertionResults)) return null;
  const rows = suites[0].assertionResults;
  if (rows.length !== 22 || new Set(rows.map(row => row.fullName)).size !== 22
    || rows.some(row => typeof row.fullName !== "string" || !["passed", "failed", "pending", "skipped", "todo"].includes(row.status))) return null;
  const statuses = rows.map(row => row.status === "passed" ? "passed" : row.status === "failed" ? "failed" : "skipped");
  return { statuses, passed: report.success === true && report.numTotalTests === 22 && report.numPassedTests === 22
    && report.numFailedTests === 0 && report.numPendingTests === 0 && statuses.every(value => value === "passed") };
}

async function supervise() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--isolated-child"], {
    cwd: adminRoot, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let manifest; let phase = "staging"; let results; let timedOut = false;
  const phases = new Set(["fixture-preflight", "database-reset", "integration-tests", "fixture-cleanup"]);
  child.on("message", message => {
    if (message?.kind === "stage" && typeof message.manifest === "string") manifest = message.manifest;
    if (message?.kind === "phase" && phases.has(message.value)) { phase = message.value; console.log(`v11_phase=${phase}`); }
    if (message?.kind === "results") results = message.summary;
  });
  // Twelve minutes includes staging/reset, five-minute Vitest and normal cleanup.
  // A forced stop has a separate two-minute ownership-checked cleanup budget.
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* Exit status remains authoritative. */ }
  }, 12 * 60_000);
  const code = await new Promise(resolveExit => {
    child.once("error", () => resolveExit(null));
    child.once("close", status => resolveExit(status));
  });
  clearTimeout(timer);
  if (results && Array.isArray(results.statuses) && results.statuses.length === 22
    && results.statuses.every(value => ["passed", "failed", "skipped"].includes(value))) {
    results.statuses.forEach((status, index) => console.log(`v11_case=${index + 1} status=${status}`));
    for (const status of ["passed", "failed", "skipped"]) console.log(`v11_${status}=${results.statuses.filter(value => value === status).length}`);
  } else console.log("v11_results=unavailable_or_invalid");
  if (timedOut || code !== 0) {
    // Also kill surviving test descendants before any fallback resource cleanup.
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* Process group already absent. */ }
    let cleanup = "unverified";
    if (manifest) {
      const result = spawnSync(process.execPath, [resolve(adminRoot, "tests/rls-runtime/stage-local-supabase.mjs"), "--cleanup-manifest", manifest], {
        stdio: "ignore", timeout: 120_000, killSignal: "SIGKILL",
      });
      if (result.status === 0) cleanup = "ownership_verified";
    }
    console.log(`v11_failure_phase=${phase} outcome=${timedOut ? "timeout" : "failed"} fallback_cleanup=${cleanup}`);
    console.log("v11_vm_disposal=required_final_isolation_boundary");
    process.exitCode = 1;
  } else if (results?.passed !== true) {
    console.log("v11_acceptance=failed"); process.exitCode = 1;
  } else console.log("v11_acceptance=passed application_cleanup=completed");
}

if (process.argv.includes("--security-self-test")) {
  const report = { success: true, numTotalTests: 22, numPassedTests: 22, numFailedTests: 0, numPendingTests: 0,
    testResults: [{ assertionResults: Array.from({ length: 22 }, (_, index) => ({ fullName: `synthetic-${index}`, status: "passed" })) }] };
  assert.equal(summarizeResults(report).passed, true);
  for (const status of ["failed", "pending", "skipped", "todo"]) {
    const copy = globalThis.structuredClone(report); copy.testResults[0].assertionResults[0].status = status;
    assert.equal(summarizeResults(copy).passed, false);
  }
  const duplicate = globalThis.structuredClone(report); duplicate.testResults[0].assertionResults[1].fullName = "synthetic-0";
  assert.equal(summarizeResults(duplicate), null);
  assert.equal(summarizeResults({}), null);
  assert.equal(summarizeResults({ ...report, success: false }).passed, false);
  for (const count of [0, 21, 23]) {
    const copy = globalThis.structuredClone(report);
    copy.testResults[0].assertionResults = Array.from({ length: count }, (_, index) => ({ fullName: `synthetic-${index}`, status: "passed" }));
    assert.equal(summarizeResults(copy), null);
  }
  const malformed = globalThis.structuredClone(report); malformed.testResults[0].assertionResults[0].status = "unknown-secret";
  assert.equal(summarizeResults(malformed), null);
  const hanging = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  const timer = setTimeout(() => process.kill(-hanging.pid, "SIGKILL"), 100);
  const signal = await new Promise((resolveSignal, reject) => { hanging.once("error", reject); hanging.once("close", (_code, value) => resolveSignal(value)); });
  clearTimeout(timer); assert.equal(signal, "SIGKILL");
  console.log("V11 runner result-count and process-timeout safety self-tests passed");
} else if (process.argv.includes("--isolated-child") && process.send) {
  integration().catch(() => { process.exitCode = 1; }).finally(() => process.disconnect());
} else if (process.argv.length === 2) await supervise();
else { console.error("Invalid V11 runner arguments"); process.exitCode = 2; }
