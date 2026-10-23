import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  artifactNames, caseNames, coverage, sha256, makeManifest, verifyArtifacts,
  restoreInputs, assertConsistent, safeResult, safeTestResults, verifyTestResults, sealArtifacts, openArtifacts,
} from "./backup-recovery-contract.mjs";

const artifacts = () => new Map(artifactNames.map(name => [name, Buffer.from(`synthetic fixture ${name}`)]));
const report = () => ({ success: true, numTotalTests: caseNames.length, numPassedTests: caseNames.length,
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ assertionResults: caseNames.map(title => ({ title, status: "passed" })) }] });
const snapshot = () => Object.fromEntries(["database", "auth", "storage", "references"].map(key => [key, sha256(key)]));

test("complete synthetic artifact inventory verifies exact bytes and ordering", () => {
  const files = artifacts(); const manifest = makeManifest(files);
  assert.equal(verifyArtifacts(manifest, files), true);
  assert.equal(manifest.artifacts.length, artifactNames.length);
  assert.deepEqual(manifest.artifacts.map(entry => entry.name), artifactNames);
});

for (const name of artifactNames) {
  test(`missing artifact rejected: ${name}`, () => {
    const files = artifacts(); const manifest = makeManifest(files); files.delete(name);
    assert.throws(() => verifyArtifacts(manifest, files), /synthetic-backup-contract-rejected/);
  });
}

test("changed bytes with unchanged length are rejected against trusted manifest", () => {
  const files = artifacts(); const manifest = makeManifest(files);
  files.get("data.sql")[0] ^= 1;
  assert.throws(() => verifyArtifacts(manifest, files));
});

test("extra, traversal, absolute, encoded, case-colliding and nested paths are rejected", () => {
  for (const name of ["../data.sql", "/etc/passwd", "objects/../../data.sql", "objects/%2e%2e/data.sql",
    "DATA.SQL", "objects\\synthetic.pdf", "objects/nested/synthetic.pdf", "extra.sql"]) {
    const files = artifacts(); files.set(name, Buffer.from("synthetic"));
    assert.throws(() => makeManifest(files));
    files.delete("data.sql"); assert.throws(() => makeManifest(files));
  }
});

test("malformed, reordered, duplicated and additional manifest entries are rejected", () => {
  const files = artifacts();
  for (const change of [
    m => { m.artifacts.reverse(); }, m => { m.artifacts[1] = m.artifacts[0]; },
    m => { m.artifacts.push(m.artifacts[0]); }, m => { m.scope = "production"; },
    m => { m.cliVersion = "latest"; }, m => { m.artifacts[0].bytes = -1; },
    m => { m.artifacts[0].sha256 = "not-a-hash"; }, m => { m.secret = "synthetic-secret"; },
    m => { m.artifacts[0].url = "https://sensitive.invalid"; },
  ]) {
    const manifest = makeManifest(files); change(manifest);
    assert.throws(() => verifyArtifacts(manifest, files));
  }
  for (const invalid of [null, [], {}, "secret", { artifacts: [] }]) assert.throws(() => verifyArtifacts(invalid, files));
});

test("artifact input is bounded, nonempty and binary", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(16 * 1024 * 1024 + 1), "synthetic", null]) {
    const files = artifacts(); files.set("data.sql", bytes); assert.throws(() => makeManifest(files));
  }
  const files = new Map(artifactNames.map(name => [name, Buffer.alloc(7 * 1024 * 1024)]));
  assert.throws(() => makeManifest(files));
});

test("migration history remains backed up but never enters automatic restore", () => {
  const files = artifacts(); const manifest = makeManifest(files); const inputs = restoreInputs(manifest, files);
  assert(manifest.artifacts.some(entry => entry.name === "history-schema.sql"));
  assert(manifest.artifacts.some(entry => entry.name === "history-data.sql"));
  assert.deepEqual(inputs.map(entry => entry.name), ["roles.sql", "schema.sql", "data.sql"]);
  inputs[0].bytes[0] ^= 1;
  assert.equal(verifyArtifacts(manifest, files), true);
});

for (const component of ["database", "auth", "storage", "references"]) {
  test(`snapshot drift rejected: ${component}`, () => {
    const before = snapshot(); const after = snapshot(); after[component] = sha256("changed");
    assert.throws(() => assertConsistent(before, after));
  });
}

test("matching snapshots are necessary evidence only; missing components fail", () => {
  assert.equal(assertConsistent(snapshot(), snapshot()), true);
  for (const invalid of [null, {}, { ...snapshot(), extra: "secret" }, { ...snapshot(), auth: "unknown" }]) {
    assert.throws(() => assertConsistent(snapshot(), invalid));
  }
});

test("CLI source evidence does not claim managed schema restore verified", () => {
  for (const key of ["auth", "storage", "vault"]) assert.equal(coverage[key].restore, "unverified");
  assert.equal(coverage.supabase_migrations.restore, "excluded");
  assert.equal(coverage.externalSecrets.backup, "excluded");
});

test("only every distinct required test actually passed can satisfy count contract", () => {
  assert.equal(verifyTestResults(report()), true);
  for (const change of [r => { r.numTotalTests--; }, r => { r.numPassedTests--; }, r => { r.numFailedTests++; },
    r => { r.numPendingTests++; }, r => { r.numTodoTests++; }, r => { r.success = false; },
    r => { r.testResults[0].assertionResults.pop(); },
    r => { r.testResults[0].assertionResults[0].title = caseNames[1]; },
    r => { r.testResults[0].assertionResults[0].status = "skipped"; },
    r => { r.testResults[0].assertionResults[0].status = "unverified"; },
  ]) { const r = report(); change(r); assert.equal(verifyTestResults(r), false); }
  for (const invalid of [null, {}, [], { testResults: [] }]) assert.equal(verifyTestResults(invalid), false);
});

test("safe projections never expose malicious reports, exceptions, URLs or credentials", () => {
  const secret = "Bearer synthetic-JWT password=synthetic-secret https://sensitive.invalid /private/path";
  const r = report();
  r.testResults[0].assertionResults[0] = { title: secret, status: secret, failureMessages: [secret], stack: secret };
  const output = JSON.stringify([safeTestResults(r), safeResult(secret, secret), safeResult("restore", secret)]);
  for (const fragment of [secret, "Bearer", "password=", "https://", "/private/", "failureMessages", "stack"]) {
    assert(!output.includes(fragment));
  }
  assert.deepEqual(safeResult(secret, secret), { stage: "unknown", status: "unverified" });
  assert.equal(safeTestResults(r)[0].status, "unverified");
  assert(safeTestResults(null).every(item => item.status === "unverified"));
});

test("duplicate, failed, skipped or absent cases never project as verified", () => {
  for (const status of ["failed", "skipped", "pending", "todo", "unverified", null]) {
    const r = report(); r.testResults[0].assertionResults[0].status = status;
    assert.notEqual(safeTestResults(r)[0].status, "verified");
  }
  const r = report(); r.testResults[0].assertionResults.push(r.testResults[0].assertionResults[0]);
  assert.equal(safeTestResults(r)[0].status, "unverified");
});


test("authenticated encryption round trip, wrong key and corruption rejection", () => {
  const key = Buffer.alloc(32, 17); const files = artifacts();
  const encrypted = sealArtifacts(files, key);
  assert.deepEqual(openArtifacts(encrypted, key).files, files);
  assert(!encrypted.includes(files.get("data.sql")));
  assert.throws(() => openArtifacts(encrypted, Buffer.alloc(32, 18)), /synthetic-backup-contract-rejected/);
  for (const offset of [0, 12, encrypted.length - 1]) {
    const corrupt = Buffer.from(encrypted); corrupt[offset] ^= 1;
    assert.throws(() => openArtifacts(corrupt, key), /synthetic-backup-contract-rejected/);
  }
  assert.throws(() => openArtifacts(encrypted.subarray(0, -1), key));
  assert.throws(() => openArtifacts(Buffer.alloc(0), key));
  assert.notDeepEqual(sealArtifacts(files, key), encrypted);
});
