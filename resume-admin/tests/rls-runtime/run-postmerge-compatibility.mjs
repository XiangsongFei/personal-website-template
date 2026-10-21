// TEST ONLY. Candidate schema/Worker matrix, never a Production compatibility claim.
/* global console, process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { withStagedLocalSupabase } from "./stage-local-supabase.mjs";
import { candidateWorkerSha, migrations, combinations, verifiedResults, safeResults, waitBoundedChild, candidateStages, safeStageResult, candidateStep, observeCompatibilityStaging } from "./compatibility-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const admin = resolve(here, "../..");
const self = fileURLToPath(import.meta.url);
const phases = ["staging", "candidate-source", "old-db-old-worker", "old-db-new-worker", "upgrade", "new-db-old-worker", "new-db-new-worker", "client-recovery", "cleanup"];
const send = (message) => process.send?.(message);
const phase = (value) => send({ kind: "phase", value });
function checked(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, ...options });
  if (r.error || r.signal || r.status !== 0) throw new Error("bounded subprocess failed");
  return r.stdout;
}
function sql(stage, input) {
  assert.match(stage.projectId, /^pr1-[0-9]+-[a-f0-9]+$/);
  assert.equal(stage.dbContainer, `supabase_db_${stage.projectId}`);
  return checked("docker", ["exec", "-i", stage.dbContainer, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input }).trim();
}
function boundarySnapshot(stage) {
  // Synthetic settings and catalog metadata only; values remain inside this process.
  return sql(stage, `SELECT jsonb_build_object(
    'modes',(SELECT jsonb_agg(to_jsonb(m) ORDER BY resume_id,domain_key) FROM cms_private.resume_write_modes m),
    'requirements',(SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,domain_key,requirement_key) FROM cms_private.resume_domain_requirements r),
    'capabilities',(SELECT jsonb_agg(to_jsonb(c) ORDER BY resume_id,capability_key) FROM cms_private.resume_capabilities c),
    'admins',(SELECT jsonb_agg(to_jsonb(a) ORDER BY user_id) FROM public.cms_admins a),
    'authorization',(SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','cms_private') AND p.proname IN ('can_manage_resume','assert_activity_log_target','assert_activity_log_read_target')),
    'files_acl',(SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proowner,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cms_private' AND p.proname IN ('files_historical_reference_is_allowed','files_restore_source')),
    'rls',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname='public')
  )::text;`);
}
function metadata(stage, upgraded) {
  assert.equal(sql(stage, `SELECT count(*) FROM cms_private.resume_capabilities WHERE capability_key='restore' AND enabled`), "0");
  assert.equal(sql(stage, `SELECT (to_regprocedure('public.save_resume_awards_v1(uuid,text,text,text)') IS ${upgraded ? "NOT " : ""}NULL)::text`), "false");
  assert.equal(sql(stage, `SELECT (to_regprocedure('public.save_resume_awards_v1(uuid,text,text,text,text,text)') IS NOT NULL)::text`), String(upgraded));
  assert.equal(sql(stage, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname IN ('public','cms_private') AND p.proname IN ('save_resume_awards_v1','save_resume_skills_v1','save_resume_section_titles_v1','files_historical_reference_is_allowed','files_restore_source')
    AND (r.rolname<>'postgres' OR NOT p.prosecdef OR NOT ('search_path=""'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))) OR has_function_privilege('anon',p.oid,'EXECUTE'))`), "0");
  send({ kind: "metadata", value: upgraded ? "new" : "old" });
}
const candidateResult = (result) => send({ kind: "candidate-result", ...result });
async function candidateSource(stage, emit = candidateResult) {
  phase("candidate-source");
  const repository = resolve(admin, "..");
  await candidateStep("candidate-git", () => assert.equal(checked("git", ["rev-parse", `${candidateWorkerSha}^{commit}`], { cwd: repository }).trim(), candidateWorkerSha), emit);
  const archive = await candidateStep("candidate-archive", () => checked("git", ["archive", "--format=tar", candidateWorkerSha, "resume-admin/src"], { cwd: repository, encoding: null }), emit);
  const dir = join(stage.stagedRoot, "candidate-source");
  const entry = join(dir, "resume-admin/src/worker/index.ts");
  await candidateStep("candidate-extract", () => {
    mkdirSync(dir);
    checked("tar", ["-xf", "-", "-C", dir], { input: archive });
    const original = checked("git", ["show", `${candidateWorkerSha}:resume-admin/src/worker/index.ts`], { cwd: repository, encoding: null });
    assert(readFileSync(entry).equals(original));
  }, emit);
  const outfile = join(stage.stagedRoot, "candidate-worker.mjs");
  await candidateStep("candidate-build", async () => {
    await build({ entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "neutral", logLevel: "silent" });
    assert(statSync(outfile).size > 0);
  }, emit);
  return pathToFileURL(outfile).href;
}
function runMatrixCase(stage, bundle, db, worker) {
  const combination = `${db}-db-${worker}-worker`;
  assert(combinations.includes(combination)); phase(combination);
  const snapshot = boundarySnapshot(stage);
  const report = join(stage.stagedRoot, `${combination}.json`);
  const r = spawnSync(process.execPath, [join(admin, "node_modules/vitest/vitest.mjs"), "run", "tests/postmerge-compatibility.test.ts", "--reporter=json", `--outputFile=${report}`, "--testTimeout=60000", "--hookTimeout=60000"], {
    cwd: admin, stdio: "ignore", timeout: 300_000, killSignal: "SIGKILL",
    env: { ...process.env, COMPAT_MATRIX: "1", COMPAT_DB: db, COMPAT_WORKER: worker, COMPAT_API: stage.apiUrl, COMPAT_DB_CONTAINER: stage.dbContainer, COMPAT_AUTH_CONTAINER: stage.authContainer, COMPAT_OLD_BUNDLE: bundle, COMPAT_PENDING_FILE: join(stage.stagedRoot, "candidate-pending.json") },
  });
  let parsed;
  try { assert(statSync(report).size <= 4 * 1024 * 1024); parsed = JSON.parse(readFileSync(report, "utf8")); } catch { parsed = null; }
  const passed = !r.error && !r.signal && r.status === 0 && verifiedResults(parsed);
  send({ kind: "matrix", combination, passed, results: safeResults(parsed) });
  assert.equal(boundarySnapshot(stage), snapshot, "fixture settings must be restored");
  assert(passed, "matrix assertions failed");
}
async function child() {
  phase("staging");
  await observeCompatibilityStaging(callback => withStagedLocalSupabase(callback, "candidate-pre-pr28"), async stage => {
    const bundle = await candidateSource(stage);
    await candidateStep("candidate-metadata", () => metadata(stage, false), candidateResult);
    runMatrixCase(stage, bundle, "old", "old");
    runMatrixCase(stage, bundle, "old", "new");
    phase("upgrade");
    const boundary = boundarySnapshot(stage);
    // Verify failed DDL transactions cannot leak partial catalog changes.
    const failed = spawnSync("docker", ["exec", "-i", stage.dbContainer, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: "BEGIN; CREATE TABLE public.compatibility_rollback_probe(id integer); SELECT 1/0; COMMIT;", encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.equal(failed.status, 3);
    assert.equal(sql(stage, "SELECT to_regclass('public.compatibility_rollback_probe') IS NULL"), "t");
    for (const [name, digest] of migrations) {
      const content = readFileSync(join(admin, "migrations", name));
      assert.equal(createHash("sha256").update(content).digest("hex"), digest);
      for (const dir of [join(admin, "supabase/migrations"), join(here, "supabase/migrations")]) assert(content.equals(readFileSync(join(dir, name))));
      sql(stage, `SET lock_timeout='2s'; SET statement_timeout='25s';\n${content.toString("utf8")}`);
      assert.equal(boundarySnapshot(stage), boundary, "structural migration changed protected settings");
      send({ kind: "migration", index: migrations.findIndex(([x]) => x === name) + 1 });
    }
    await candidateStep("candidate-metadata", () => metadata(stage, true), candidateResult);
    sql(stage, "NOTIFY pgrst, 'reload schema';");
    runMatrixCase(stage, bundle, "new", "old"); // Deployment fails / rollback to the same candidate old Worker.
    runMatrixCase(stage, bundle, "new", "new");
    phase("client-recovery");
    const report = join(stage.stagedRoot, "client-recovery.json");
    const r = spawnSync(process.execPath, [join(admin, "node_modules/vitest/vitest.mjs"), "run", "tests/pending-save-safety.test.ts", "tests/skills-aggregate-repository.test.ts", "tests/website-files-aggregate.test.ts", "tests/production-repeatable-crud.test.tsx", "--reporter=json", `--outputFile=${report}`], { cwd: admin, stdio: "ignore", timeout: 300_000, killSignal: "SIGKILL" });
    assert(!r.error && !r.signal && r.status === 0);
    assert(statSync(report).size <= 8 * 1024 * 1024);
    const results = JSON.parse(readFileSync(report, "utf8"));
    assert(results.success === true && results.numTotalTests > 0 && results.numPassedTests === results.numTotalTests && results.numFailedTests === 0 && results.numPendingTests === 0);
    send({ kind: "client", passed: true, count: results.numTotalTests });
    phase("cleanup");
  }, (stage, status) => send({ kind: "stage-result", stage, status }));
}

async function supervise() {
  console.log(`compat_candidate_worker=${candidateWorkerSha} production_provenance=unverified`);
  const childProcess = spawn(process.execPath, [self, "--child"], { cwd: admin, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  let manifest, current = "staging", cleaned = false, cleanupStatus = "unverified", clients = false;
  const seen = new Set(); let migrationCount = 0; const meta = new Set();
  childProcess.on("message", m => {
    if (m?.kind === "compat-manifest" && typeof m.path === "string") manifest = m.path;
    if (m?.kind === "phase" && phases.includes(m.value)) { current = m.value; console.log(`compat_phase=${current}`); }
    if (m?.kind === "matrix" && combinations.includes(m.combination)) {
      if (seen.has(m.combination)) return;
      if (m.passed === true && Array.isArray(m.results) && m.results.length === 5 && m.results.every((r,i) => r.name === ["awards","skills","section-titles","files-reference","authorization"][i] && r.status === "passed")) seen.add(m.combination);
      console.log(`compat_combination=${m.combination} assertions=${seen.has(m.combination) ? "passed" : "failed"} awards_skills=${["old-db-old-worker", "new-db-new-worker"].includes(m.combination) ? "compatible_expected" : "rejection_expected"}`);
      for (const r of safeResults({ testResults: [{ assertionResults: (m.results ?? []).map(x => ({ title: x.name, status: x.status })) }] })) console.log(`compat_case=${r.name} status=${r.status}`);
    }
    if (m?.kind === "migration" && Number.isInteger(m.index) && m.index === migrationCount + 1 && m.index <= 7) { migrationCount++; console.log(`compat_migration=${migrationCount} status=passed`); }
    if (m?.kind === "metadata" && ["old", "new"].includes(m.value)) { meta.add(m.value); console.log(`compat_catalog=${m.value} status=passed`); }
    if (m?.kind === "client" && m.passed === true && Number.isInteger(m.count) && m.count > 0 && m.count <= 10000) { clients = true; console.log(`compat_client_tests=${m.count} type=mock status=passed`); }
    if (m?.kind === "candidate-result") {
      const result = safeStageResult(m.stage, m.status);
      console.log(`compat_detail=${result.stage} status=${result.status}`);
    }
    if (m?.kind === "stage-result" && ["callback", "resources"].includes(m.stage) && ["success", "failed", "unverified"].includes(m.status)) {
      if (m.stage === "resources") { cleanupStatus = m.status; cleaned = m.status === "success"; }
      else console.log(`compat_callback=${m.status}`);
    }
  });
  const { code, timedOut } = await waitBoundedChild(childProcess, 25 * 60_000, () => {
    try { process.kill(-childProcess.pid, "SIGKILL"); } catch { /* Already exited. */ }
  });
  const passed = code === 0 && !timedOut && seen.size === 4 && migrationCount === 7 && meta.size === 2 && clients && cleaned;
  console.log(`compat_resources=${cleanupStatus}`);
  if (!passed) {
    try { process.kill(-childProcess.pid, "SIGKILL"); } catch { /* No surviving group. */ }
    let fallback = cleaned ? "not_needed" : "unverified";
    if (!cleaned && manifest) {
      const r = spawnSync(process.execPath, [join(here, "stage-local-supabase.mjs"), "--cleanup-manifest", manifest], { stdio: "ignore", timeout: 120_000, killSignal: "SIGKILL" });
      if (!r.error && !r.signal && r.status === 0) fallback = "ownership_verified";
    }
    console.log(`compat_outcome=${timedOut ? "timeout" : "failed"} phase=${current} fallback_cleanup=${fallback}`);
    console.log("compat_vm_disposal=required"); process.exitCode = 1;
  } else console.log("compat_outcome=passed production_compatibility=unverified");
}
async function candidateSourceSelfTest() {
  const root = mkdtempSync(join(tmpdir(), "candidate-source-self-test-"));
  const results = [];
  try {
    await candidateSource({ stagedRoot: root }, result => results.push(result));
    assert.deepEqual(results, candidateStages.slice(0, 4).map(stage => ({ stage, status: "success" })));
    for (const result of results) console.log(`compat_detail=${result.stage} status=${result.status}`);
  } catch { console.log("compat_source_self_test=failed"); process.exitCode = 1; }
  finally { rmSync(root, { recursive: true, force: true }); }
}
if (process.argv.length === 3 && process.argv[2] === "--candidate-source-self-test") await candidateSourceSelfTest();
else if (process.argv[2] === "--child") child().catch(() => { send({ kind: "failed" }); process.exitCode = 1; });
else if (process.argv.length === 2) supervise().catch(() => { console.log("compat_outcome=failed"); process.exitCode = 1; });
else { console.log("compat_outcome=invalid_arguments"); process.exitCode = 1; }
