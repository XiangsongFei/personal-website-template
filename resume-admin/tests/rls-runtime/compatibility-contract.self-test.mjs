import test from "node:test";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { setTimeout } from "node:timers";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { migrations, combinations, caseNames, verifiedResults, safeResults, waitBoundedChild, candidateStep, safeStageResult, observeCompatibilityStaging, candidateSchemaSha, candidateBaselineMigrations, candidateHistoricalExclusions, verifyCandidateMigrationFiles, stageCandidateMigrations } from "./compatibility-contract.mjs";
const admin = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const valid = () => ({ success: true, numTotalTests: 5, numPassedTests: 5, numFailedTests: 0, numPendingTests: 0,
  testResults: [{ assertionResults: caseNames.map(title => ({ title, status: "passed" })) }] });
test("matrix requires all five distinct named cases without skips", () => {
  assert(verifiedResults(valid()));
  for (const change of [r => r.numTotalTests--, r => r.numPassedTests--, r => r.numPendingTests++, r => r.numFailedTests++, r => r.success=false,
    r => r.testResults[0].assertionResults.pop(), r => r.testResults[0].assertionResults[0].status="skipped",
    r => r.testResults[0].assertionResults[0].title="skills"]) {
    const report = valid(); change(report); assert.equal(verifiedResults(report), false);
  }
  for (const bad of [null, {}, { testResults: [] }]) assert.equal(verifiedResults(bad), false);
  assert.equal(new Set(combinations).size, 4);
});
test("safe projection cannot emit malicious failure text or unknown names", () => {
  const secret = "Bearer simulated-JWT password=simulated-secret https://sensitive.invalid";
  const report = valid();
  report.testResults[0].assertionResults[0] = { title: secret, status: secret, failureMessages: [secret] };
  const output = JSON.stringify(safeResults(report));
  assert(!output.includes(secret)); assert(!output.includes("failureMessages"));
  assert.equal(safeResults(report)[0].status, "unverified");
});
test("seven structural inputs are ordered, hash pinned, mirrored and contain no activation", () => {
  assert.equal(migrations.length, 7);
  assert.deepEqual(migrations.map(([x])=>x), migrations.map(([x])=>x).sort());
  for (const [name, hash] of migrations) {
    assert(!/routing|activation/.test(name));
    const bytes = readFileSync(resolve(admin, "migrations", name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    assert(bytes.equals(readFileSync(resolve(admin, "supabase/migrations", name))));
    assert(bytes.equals(readFileSync(resolve(admin, "tests/rls-runtime/supabase/migrations", name))));
  }
});
test("supervisor bounds execution and uses verified fallback cleanup", () => {
  const source = readFileSync(resolve(admin, "tests/rls-runtime/run-postmerge-compatibility.mjs"), "utf8");
  assert(source.includes("25 * 60_000")); assert(source.includes("timeout: 120_000"));
  assert(source.includes('"--cleanup-manifest"')); assert(source.includes('seen.size === 4'));
  assert(source.includes('migrationCount === 7')); assert(source.includes('clients && cleaned'));
  assert(!source.includes("prune")); assert(!source.includes("failureMessages"));
});

test("bounded child preserves nonzero exits and kills timed-out group", async () => {
  for (const code of [0, 1, null]) {
    const child = new EventEmitter();
    const waited = waitBoundedChild(child, 100, () => assert.fail("unexpected kill"));
    child.emit("close", code);
    assert.deepEqual(await waited, { code, timedOut: false });
  }
  const child = new EventEmitter(); let killed = 0;
  const waited = waitBoundedChild(child, 5, () => { killed++; child.emit("close", null); });
  assert.deepEqual(await waited, { code: null, timedOut: true }); assert.equal(killed, 1);
  const failed = new EventEmitter();
  const launched = waitBoundedChild(failed, 100, () => assert.fail("unexpected kill"));
  setTimeout(() => failed.emit("error", new Error("simulated-secret")), 0);
  assert.deepEqual(await launched, { code: null, timedOut: false });
});


test("both fixture path guards accept staging suffixes and reject unsafe paths", () => {
  const source = readFileSync(resolve(admin, "tests/postmerge-compatibility.test.ts"), "utf8");
  const token = "1792530000000-aabbccddeeff";
  for (const [variable, scheme, filename] of [["pendingPath", "", "candidate-pending.json"], ["workerPath", "file://", "candidate-worker.mjs"]]) {
    const line = source.split("\n").find(x => x.includes(`const ${variable} = /`));
    assert(line);
    const pattern = line.slice(line.indexOf("= /") + 3, line.lastIndexOf("/.exec("));
    const guard = new RegExp(pattern);
    const path = `${scheme}/tmp/pr1-supabase-${token}-Ab12Cd/${filename}`;
    assert.equal(guard.exec(path)?.[1], token);
    assert(source.includes('`supabase_db_pr1-${' + variable + '[1]}` !== process.env.COMPAT_DB_CONTAINER'));
    for (const invalid of [
      path.replace("pr1-supabase-", "other-"), path.replace("-Ab12Cd", ""),
      path.replace("Ab12Cd", "Ab!2Cd"), path.replace("Ab12Cd", "Ab12Cd7"),
      path.replace("/tmp/", "/tmp/../"), path.replace("/tmp/", "/tmp/./"),
      path.replace(`/${filename}`, `/nested/${filename}`), path + "/extra",
      path.replace(`/${filename}`, `//${filename}`), path.replace("/tmp/", "/tmp/%2e%2e/"),
      path.replace("aabbccddeeff", "aabb"), path + "?injected=/etc/passwd",
      path.replace(filename, "other.mjs"), path.replace("/tmp/", "/tmp/\\escape/"),
    ]) assert.equal(guard.test(invalid), false);
    assert.notEqual(guard.exec(path.replace(token, "1792530000001-aabbccddeeff"))?.[1], token);
  }
});


test("candidate diagnostics project only fixed stages and results", async () => {
  const secret = "simulated-secret /private/path Bearer simulated-token";
  for (const fails of [false, true]) {
    const events = []; const error = new Error(secret);
    try { await candidateStep("candidate-archive", () => { if (fails) throw error; return 7; }, e => events.push(e)); }
    catch (caught) { assert(fails); assert.equal(caught, error); }
    assert.deepEqual(events, [{ stage: "candidate-archive", status: fails ? "failed" : "success" }]);
    assert(!JSON.stringify(events).includes(secret));
  }
  assert.deepEqual(safeStageResult(secret, secret), { stage: "unknown", status: "unverified" });
  await assert.rejects(candidateStep("candidate-build", () => 1, () => { throw new Error(secret); }));
});

test("callback failures and verified cleanup have independent outcomes", async () => {
  for (const callbackFails of [false, true]) for (const cleanupFails of [false, true]) {
    const events = []; const callbackError = new Error("simulated callback secret");
    const cleanupError = new Error("simulated cleanup secret");
    const staging = async callback => {
      let failure;
      try { await callback(); } catch (error) { failure = error; }
      if (cleanupFails) throw cleanupError;
      if (failure) throw failure;
    };
    let caught;
    try { await observeCompatibilityStaging(staging, async () => { if (callbackFails) throw callbackError; }, (stage, status) => events.push([stage, status])); }
    catch (error) { caught = error; }
    assert.equal(caught, cleanupFails ? cleanupError : callbackFails ? callbackError : undefined);
    assert.deepEqual(events, [["callback", callbackFails ? "failed" : "success"], ["resources", cleanupFails ? "failed" : "success"]]);
    assert(!JSON.stringify(events).includes("secret"));
  }
  const early = [];
  await assert.rejects(observeCompatibilityStaging(async () => { throw new Error("startup secret"); }, () => assert.fail("not reached"), (s, r) => early.push([s, r])));
  assert.deepEqual(early, [["callback", "unverified"], ["resources", "unverified"]]);
  await assert.rejects(observeCompatibilityStaging(async callback => callback(), async () => {}, () => { throw new Error("observer secret"); }));
});


test("candidate baseline matches the complete historical tree and SHA-256", () => {
  const root = "resume-admin/tests/rls-runtime/supabase/migrations/";
  const names = execFileSync("git", ["ls-tree", "-r", "--name-only", candidateSchemaSha, root], { cwd: resolve(admin, ".."), encoding: "utf8" }).trim().split("\n").map(path => path.slice(root.length));
  assert.deepEqual(names.filter(name => !candidateHistoricalExclusions.includes(name)), candidateBaselineMigrations.map(([name]) => name));
  const entries = candidateBaselineMigrations.map(([name]) => [name, execFileSync("git", ["show", `${candidateSchemaSha}:${root}${name}`], { cwd: admin })]);
  verifyCandidateMigrationFiles(entries);
  for (const mutate of [x => x.pop(), x => x.push(x[0]), x => x.reverse(), x => x[0] = ["20990101000000_future.sql", x[0][1]], x => x[0] = [x[0][0], Buffer.from("changed")]]) {
    const changed = entries.map(([name, bytes]) => [name, Buffer.from(bytes)]); mutate(changed);
    assert.throws(() => verifyCandidateMigrationFiles(changed));
  }
});

test("candidate staging rejects future migrations and source drift before copying", () => {
  const root = mkdtempSync(resolve(tmpdir(), "candidate-manifest-test-"));
  const source = resolve(root, "source"); const destination = resolve(root, "staged");
  try {
    cpSync(resolve(admin, "tests/rls-runtime/supabase/migrations"), source, { recursive: true });
    stageCandidateMigrations(source, destination);
    assert.deepEqual(readdirSync(destination).sort(), candidateBaselineMigrations.map(([name]) => name));
    rmSync(destination, { recursive: true });
    const future = resolve(source, "20990101000000_future.sql");
    writeFileSync(future, "SELECT 1;");
    assert.throws(() => stageCandidateMigrations(source, destination)); assert(!existsSync(destination));
    rmSync(future);
    const first = resolve(source, candidateBaselineMigrations[0][0]); const original = readFileSync(first);
    writeFileSync(first, "changed");
    assert.throws(() => stageCandidateMigrations(source, destination)); assert(!existsSync(destination));
    rmSync(first);
    assert.throws(() => stageCandidateMigrations(source, destination)); assert(!existsSync(destination));
    writeFileSync(first, original);
    const duplicate = resolve(source, candidateBaselineMigrations[0][0].slice(0, 14) + "_duplicate.sql");
    writeFileSync(duplicate, original);
    assert.throws(() => stageCandidateMigrations(source, destination)); assert(!existsSync(destination));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const { createStagingDiagnostics, safeStagingDiagnostic, stagingDiagnosticPhases } = await import('./compatibility-contract.mjs');
for (const phase of stagingDiagnosticPhases) {
  test(`staging diagnostic ${phase}: success preserves result and call count`, async () => {
    const records=[], d=createStagingDiagnostics(r=>records.push(r)); let calls=0;
    const result={synthetic:true};
    assert.equal(d.step(phase,()=>{calls++;return result;}),result);
    assert.equal(await d.stepAsync(phase,async()=>{calls++;return result;}),result);
    assert.equal(calls,2);
    assert.deepEqual(records.map(r=>r.status),['unverified','success','unverified','success']);
    assert(records.every(r=>r.phase===phase && r.resources==='not-created' && r.manifest==='not-created'));
  });
  test(`staging diagnostic ${phase}: failure preserves original error and does not leak`, async () => {
    const records=[], d=createStagingDiagnostics(r=>records.push(r));
    const error=new Error('synthetic-secret JWT internal-path');
    assert.throws(()=>d.step(phase,()=>{throw error;}),e=>e===error);
    await assert.rejects(d.stepAsync(phase,async()=>{throw error;}),e=>e===error);
    assert.deepEqual(records.map(r=>r.status),['unverified','failed','unverified','failed']);
    assert(!JSON.stringify(records).includes('synthetic-secret'));
  });
  test(`staging diagnostic ${phase}: timed-out operation cannot report success`, async () => {
    const records=[], d=createStagingDiagnostics(r=>records.push(r));
    const error=Object.assign(new Error('synthetic timeout'),{code:'ETIMEDOUT'});
    await assert.rejects(d.stepAsync(phase,()=>new Promise((_resolve,reject)=>setTimeout(()=>reject(error),1))),e=>e===error);
    assert.deepEqual(records.map(r=>r.status),['unverified','failed']);
  });
}
test('staging diagnostics distinguish unknown creation, observed resources, manifest and cleanup',()=>{
  const records=[], d=createStagingDiagnostics(r=>records.push(r));
  d.mark('environment-preflight','success');
  d.resourceAttempt();
  assert.throws(()=>d.step('network-creation',()=>{throw new Error('synthetic');}));
  assert.equal(records.at(-1).resources,'unverified');assert.equal(records.at(-1).manifest,'not-created');
  d.step('ownership-verification',()=>d.resourceCreated());
  d.step('manifest-creation',()=>d.manifestCreated());
  d.mark('manifest-delivery','unverified');
  assert.equal(records.at(-1).manifest,'created');
  assert.equal(records.at(-1).resources,'created');
  assert.equal(records.at(-1).status,'unverified'); // only parent reception confirms delivery
  assert.throws(()=>d.step('cleanup',()=>{throw new Error('synthetic');}));
  assert.equal(records.at(-1).status,'failed');assert.equal(records.at(-1).manifest,'created');
  d.step('cleanup',()=>{});assert.equal(records.at(-1).status,'success');
});
test('staging diagnostics preserve failure before manifest and no-resource cleanup without fabricated success',()=>{
  const records=[],d=createStagingDiagnostics(r=>records.push(r));
  assert.throws(()=>d.step('image-verification',()=>{throw new Error('synthetic');}));
  d.step('ownership-verification',()=>{});
  d.mark('cleanup','not-needed');
  assert.equal(records.at(-1).status,'not-needed');
  assert.equal(records.at(-1).resources,'not-created');assert.equal(records.at(-1).manifest,'not-created');
  assert(!records.some(r=>r.phase==='manifest-delivery'&&r.status==='success'));
});
test('staging diagnostics do not invent a result for a pending operation or unavailable reporter',async()=>{
  const records=[], d=createStagingDiagnostics(r=>records.push(r));let finish;
  const pending=d.stepAsync('supabase-start',()=>new Promise(resolve=>{finish=resolve;}));
  assert.deepEqual(records.map(r=>r.status),['unverified']);finish();await pending;
  const unavailable=createStagingDiagnostics(()=>{throw new Error('IPC unavailable');});
  assert.equal(unavailable.step('cleanup',()=>42),42);
  const error=new Error('original');assert.throws(()=>unavailable.step('cleanup',()=>{throw error;}),e=>e===error);
});
test('staging output projection rejects malicious fields without exposing resource identifiers',()=>{
  const secret='synthetic-secret';
  for(const input of [null,undefined,{},secret,{phase:secret,status:secret,resources:secret,manifest:secret,path:secret,env:secret}]) {
    const safe=safeStagingDiagnostic(input);
    assert.deepEqual(safe,{phase:'unknown',status:'unverified',resources:'unverified',manifest:'unverified'});
    assert(!JSON.stringify(safe).includes(secret));
  }
});
test('actual staging call sites retain ownership, startup and cleanup ordering and manifest receipt remains parent-owned',()=>{
  const helper=readFileSync(resolve(admin,'tests/rls-runtime/stage-local-supabase.mjs'),'utf8');
  const source=helper.slice(helper.indexOf('export async function withStagedLocalSupabase('));
  for(const phase of stagingDiagnosticPhases)assert(source.includes(`"${phase}"`));
  const ordered=['snapshot()','prefetchVerifiedSupabaseImages()','createLoopbackNetwork(projectId)',
    'startDockerContainerEventObserver(projectId','runSupabase(context, ["start"])','await callback(resolved',
    'cleanupStep("ownership-check"','cleanupOwnedResources(resources, projectId, before)','finalizeStageDirectory(stageRoot, cleanupFailure)'];
  let last=-1;for(const call of ordered){const index=source.indexOf(call);assert(index>last);last=index;}
  assert(source.includes('if (started || resources.containers.length || resources.volumes.length || resources.networks.length)'));
  assert(source.includes('if (cleanupFailure) throw cleanupFailure;'));
  assert(source.includes('if (callbackError) throw callbackError;'));
  assert(!source.includes('mark("manifest-delivery", "success")'));
  const runner=readFileSync(resolve(admin,'tests/rls-runtime/run-postmerge-compatibility.mjs'),'utf8');
  assert(runner.includes('safeStagingDiagnostic(m)'));
  assert(runner.includes('manifest_received=${typeof manifest === "string"}'));
  assert(runner.includes('"--cleanup-manifest", manifest'));
});
