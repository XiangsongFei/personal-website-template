import test from "node:test";
import { EventEmitter } from "node:events";
import { setTimeout } from "node:timers";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { migrations, combinations, caseNames, verifiedResults, safeResults, waitBoundedChild, candidateStep, safeStageResult, observeCompatibilityStaging } from "./compatibility-contract.mjs";
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
