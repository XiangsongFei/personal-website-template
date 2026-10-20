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
await observeStaging(withStagedLocalSupabase, async (stage, supabase) => {
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
reportStage("vitest", result.status === 0 && testSummary?.passed ? "success" : "failed");
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
reportStage("fixture-check", networkCheckPassed ? "success" : "failed");
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
reportStage("fixture-restore", cleanupPassed ? "success" : "failed");
if (!networkCheckPassed) console.error("Local Worker network-context persistence check failed.");
if (!cleanupPassed) console.error("Local requirement cleanup failed; the isolated project will be removed after ownership verification.");
if (!cleanupPassed) throw new Error("Local integration fixture cleanup failed");
if (!networkCheckPassed) throw new Error("Local Worker network-context persistence check failed");
if (result.status !== 0 || !testSummary?.passed) throw new Error("Local Worker integration tests did not all execute and pass");
});

}

// No error object or dynamic error text crosses IPC. The staging helper rethrows
// the callback error by identity after successful cleanup; cleanup errors override it.
const stageNames = new Set(["vitest", "fixture-check", "fixture-restore", "resources"]);
const stageStatuses = new Set(["success", "failed", "unverified"]);
function captureStageStatus(stages, message) {
  if (message?.kind === "stage-result" && stageNames.has(message.stage) && stageStatuses.has(message.status)) stages[message.stage] = message.status;
}
function reportStage(stage, status) { process.send?.({ kind: "stage-result", stage, status }); }
async function observeStaging(stageRunner, callback, emit = reportStage) {
  let callbackError; let callbackExited = false;
  try {
    await stageRunner(async (...args) => {
      try { return await callback(...args); }
      catch (error) { callbackError = error; throw error; }
      finally { callbackExited = true; }
    });
    emit("resources", "success");
  } catch (error) {
    emit("resources", !callbackExited ? "unverified" : error === callbackError ? "success" : "failed");
    throw error;
  }
}

const trustedTestPath = resolve(adminRoot, "tests/activity-log-v11-local-integration.test.ts");
const trustedTestLines = readFileSync(trustedTestPath, "utf8").split(/\r?\n/);
const caseTitles = new Map([
  ["integrates signed Worker saves, retry semantics, trusted context, idempotency scopes, and two-session concurrency", "introduction"],
  ["integrates Awards Worker saves with local PostgREST/RPC, replay, conflict, no-op, rollback, and RLS", "awards"],
  ["integrates Projects state/read and signed Worker \u2192 PostgREST \u2192 RPC save, exact replay, and conflict", "projects"],
  ["integrates Contact mode/read, no-op, changed aggregate, generated IDs, replay, and conflict through Worker \u2192 PostgREST \u2192 RPC", "contact"],
  ["integrates Profile read, no-op, one changed aggregate, replay/conflict, direct-DML denial, and photo-origin fail-closed through Worker \u2192 PostgREST \u2192 RPC", "profile"],
  ["accepts a valid request at the 4096-byte canonical boundary and stores a result within 8192 bytes", "payload-boundary"],
  ["integrates Website & Links and Files through the Worker, local PostgREST, and typed RPCs", "website-links-files"],
  ["rejects independently tampered Awards actor/authenticated-user binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards target resume binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards domain binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards operation binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards request_id binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards mutation digest binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards baseline digest binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards database baseline proof binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards canonical payload digest binding before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards issued timestamp future bound before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards expired context before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards expiry maximum lifetime before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards signature_hex integrity before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards key ID allowlist before content or audit writes", "awards-tamper"],
  ["rejects independently tampered Awards required signed network-context fields before content or audit writes", "awards-tamper"],
 ]);
const failureClasses = new Set(["assertion", "timeout", "setup", "transport", "unknown"]);
function failureDiagnostic(row) {
  const category = caseTitles.get(row?.title) ?? "unknown";
  const fallback = { category, failure: "unknown", line: "unavailable", column: "unavailable" };
  if (category === "unknown" || !Array.isArray(row.failureMessages) || row.failureMessages.length > 8) return fallback;
  for (const text of row.failureMessages) {
    if (typeof text !== "string" || text.length > 65_536) continue;
    // Classification is a bounded message-prefix hint, not a proven root cause.
    const failure = /^AssertionError:/.test(text) ? "assertion"
      : /^Error: (?:Test|Hook) timed out in [0-9]+ms\./.test(text) ? "timeout"
      : /^(?:TypeError: fetch failed|Error: (?:ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b)/.test(text) ? "transport" : "unknown";
    // Accept only a complete stack frame for this exact checkout's trusted file.
    // Never print the frame, path, function name, message, or source contents.
    for (const frame of text.split(/\r?\n/).slice(0, 256)) {
      const match = /^\s+at (?:[^()\r\n]{1,256} \()?(.+):([0-9]{1,6}):([0-9]{1,5})\)?$/.exec(frame);
      if (!match || ![trustedTestPath, `file://${trustedTestPath}`].includes(match[1])) continue;
      const line = Number(match[2]); const column = Number(match[3]);
      if (line < 1 || line > trustedTestLines.length || column < 1 || column > trustedTestLines[line - 1].length + 1) continue;
      return { category, failure, line, column };
    }
    if (failure !== "unknown") return { ...fallback, failure };
  }
  return fallback;
}
function formatFailure(index, diagnostic) {
  if (!Number.isInteger(index) || index < 1 || index > 22 || !diagnostic) return null;
  const category = new Set([...caseTitles.values(), "unknown"]).has(diagnostic.category) ? diagnostic.category : "unknown";
  const failure = failureClasses.has(diagnostic.failure) ? diagnostic.failure : "unknown";
  const valid = Number.isInteger(diagnostic.line) && diagnostic.line >= 1 && diagnostic.line <= trustedTestLines.length
    && Number.isInteger(diagnostic.column) && diagnostic.column >= 1 && diagnostic.column <= trustedTestLines[diagnostic.line - 1].length + 1;
  return `v11_failure_case=${index} category=${category} class=${failure} line=${valid ? diagnostic.line : "unavailable"} column=${valid ? diagnostic.column : "unavailable"}`;
}

// Only fixed statuses and bounded counts leave the disposable child process.
function summarizeResults(report) {
  const suites = report?.testResults;
  if (!Array.isArray(suites) || suites.length !== 1 || !Array.isArray(suites[0].assertionResults)) return null;
  const rows = suites[0].assertionResults;
  if (rows.length !== 22 || new Set(rows.map(row => row?.fullName)).size !== 22
    || rows.some(row => !row || typeof row.fullName !== "string" || !["passed", "failed", "pending", "skipped", "todo"].includes(row.status))) return null;
  const statuses = rows.map(row => row.status === "passed" ? "passed" : row.status === "failed" ? "failed" : "skipped");
  return { statuses, diagnostics: rows.map(row => row.status === "failed" ? failureDiagnostic(row) : null), passed: report.success === true && report.numTotalTests === 22 && report.numPassedTests === 22
    && report.numFailedTests === 0 && report.numPendingTests === 0 && statuses.every(value => value === "passed") };
}

async function supervise() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--isolated-child"], {
    cwd: adminRoot, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let manifest; let phase = "staging"; let results; let timedOut = false;
  const stages = Object.fromEntries([...stageNames].map(name => [name, "unverified"]));
  const phases = new Set(["fixture-preflight", "database-reset", "integration-tests", "fixture-cleanup"]);
  child.on("message", message => {
    if (message?.kind === "stage" && typeof message.manifest === "string") manifest = message.manifest;
    if (message?.kind === "phase" && phases.has(message.value)) { phase = message.value; console.log(`v11_phase=${phase}`); }
    if (message?.kind === "results") results = message.summary;
    captureStageStatus(stages, message);
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
  for (const [stage, status] of Object.entries(stages)) console.log(`v11_stage=${stage} status=${status}`);
  if (results && Array.isArray(results.statuses) && results.statuses.length === 22
    && results.statuses.every(value => ["passed", "failed", "skipped"].includes(value))) {
    results.statuses.forEach((status, index) => {
      console.log(`v11_case=${index + 1} status=${status}`);
      if (status === "failed") {
        const line = formatFailure(index + 1, results.diagnostics?.[index]);
        if (line) console.log(line);
      }
    });
    console.log("v11_total=22");
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
  const title = [...caseTitles.keys()][0];
  const secret = "FAKE_JWT_SECRET_DO_NOT_PRINT";
  const assertion = { title, failureMessages: [`AssertionError: ${secret}\n    at ${trustedTestPath}:600:5`] };
  assert.deepEqual(failureDiagnostic(assertion), { category: "introduction", failure: "assertion", line: 600, column: 5 });
  assert.equal(formatFailure(1, failureDiagnostic(assertion)).includes(secret), false);
  for (const text of [secret, `AssertionError: ${secret}\n    at /untrusted/secret.ts:600:5`,
    `AssertionError: ${secret}\n    at ${trustedTestPath}:999999:5`,
    `AssertionError: ${secret}\n    at ${trustedTestPath}:600:99999`, "x".repeat(65_537)]) {
    const diagnostic = failureDiagnostic({ title, failureMessages: [text] });
    assert.equal(diagnostic.line, "unavailable");
    assert.equal(formatFailure(1, diagnostic).includes(secret), false);
  }
  assert.equal(failureDiagnostic({ title: secret, failureMessages: assertion.failureMessages }).category, "unknown");
  for (const messages of [null, {}, [null], [123], Array(9).fill(secret)]) {
    assert.equal(failureDiagnostic({ title, failureMessages: messages }).line, "unavailable");
  }
  assert.equal(failureDiagnostic({ title, failureMessages: ["Error: Test timed out in 5000ms."] }).failure, "timeout");
  assert.equal(failureDiagnostic({ title, failureMessages: ["TypeError: fetch failed"] }).failure, "transport");
  assert.equal(formatFailure(1, { category: secret, failure: secret, line: secret, column: secret }),
    "v11_failure_case=1 category=unknown class=unknown line=unavailable column=unavailable");
  const nullRow = globalThis.structuredClone(report); nullRow.testResults[0].assertionResults[0] = null;
  assert.equal(summarizeResults(nullRow), null);
  for (const [callbackFails, cleanupFails, expected] of [[false, false, "success"], [true, false, "success"], [false, true, "failed"], [true, true, "failed"]]) {
    const events = [];
    const callbackError = new Error(secret);
    const stageRunner = async callback => {
      let error;
      try { await callback(); } catch (caught) { error = caught; }
      if (cleanupFails) throw new Error(secret);
      if (error) throw error;
    };
    try { await observeStaging(stageRunner, async () => { if (callbackFails) throw callbackError; }, (...args) => events.push(args)); }
    catch { assert(callbackFails || cleanupFails); }
    assert.deepEqual(events, [["resources", expected]]);
    assert.equal(JSON.stringify(events).includes(secret), false);
  }
  const independent = Object.fromEntries([...stageNames].map(name => [name, "unverified"]));
  for (const [stage, status] of [["vitest", "failed"], ["fixture-check", "failed"], ["fixture-restore", "success"], ["resources", "success"]]) {
    captureStageStatus(independent, { kind: "stage-result", stage, status });
  }
  captureStageStatus(independent, { kind: "stage-result", stage: secret, status: "success" });
  captureStageStatus(independent, { kind: "stage-result", stage: "resources", status: secret });
  assert.deepEqual(independent, { vitest: "failed", "fixture-check": "failed", "fixture-restore": "success", resources: "success" });
  const early = [];
  await assert.rejects(observeStaging(async () => { throw new Error(secret); }, async () => {}, (...args) => early.push(args)));
  assert.deepEqual(early, [["resources", "unverified"]]);
  const hanging = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  const timer = setTimeout(() => process.kill(-hanging.pid, "SIGKILL"), 100);
  const signal = await new Promise((resolveSignal, reject) => { hanging.once("error", reject); hanging.once("close", (_code, value) => resolveSignal(value)); });
  clearTimeout(timer); assert.equal(signal, "SIGKILL");
  console.log("V11 runner result-count and process-timeout safety self-tests passed");
} else if (process.argv.includes("--isolated-child") && process.send) {
  integration().catch(() => { process.exitCode = 1; }).finally(() => process.disconnect());
} else if (process.argv.length === 2) await supervise();
else { console.error("Invalid V11 runner arguments"); process.exitCode = 2; }
