// TEST ONLY. This contract accepts synthetic fixtures, never a Production backup.
import { Buffer } from "node:buffer";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const cliVersion = "2.119.0";
export const statuses = Object.freeze(["verified", "excluded", "unverified", "failed"]);
export const stages = Object.freeze([
  "source", "export", "filter-coverage", "encrypt", "decrypt", "integrity",
  "target", "restore", "authorization", "auth", "storage", "consistency",
  "failure-tests", "callback", "resources", "fallback-cleanup",
]);
export const artifactNames = Object.freeze([
  "roles.sql", "schema.sql", "data.sql", "history-schema.sql", "history-data.sql",
  "security-catalog.json", "auth-coverage.json", "auth-data.sql", "storage-metadata.json",
  "objects/synthetic.pdf", "objects/synthetic.png",
]);
// History exports are evidence only. No history file belongs to the restore input.
export const restoreSqlNames = Object.freeze(["roles.sql", "schema.sql", "data.sql"]);
export const caseNames = Object.freeze([
  "schema-data", "roles-acl-rls", "functions-triggers", "auth-roundtrip",
  "storage-roundtrip", "reference-integrity", "cli-filters", "ledger-export-only",
  "encryption-roundtrip", "wrong-key", "corrupt-ciphertext", "missing-artifact",
  "changed-artifact", "database-drift", "storage-drift", "auth-drift",
  "callback-failure", "timeout", "cleanup-failure",
]);

// Source inspection is NOT an executed round-trip result. Managed-schema recovery
// and actual binary behavior remain unverified until the isolated runner checks them.
export const coverage = Object.freeze({
  auth: Object.freeze({ evidence: "cli-source", schemaDefault: "excluded", dataDefault: "included-filtered", restore: "unverified" }),
  storage: Object.freeze({ evidence: "cli-source", schemaDefault: "excluded", dataDefault: "included-filtered", restore: "unverified" }),
  vault: Object.freeze({ evidence: "cli-source", schemaDefault: "excluded", dataDefault: "excluded", restore: "unverified" }),
  supabase_migrations: Object.freeze({ evidence: "cli-source", schemaDefault: "excluded", dataDefault: "excluded", restore: "excluded" }),
  externalSecrets: Object.freeze({ evidence: "scope", backup: "excluded", restore: "excluded" }),
});

const fail = () => { throw new Error("synthetic-backup-contract-rejected"); };
const plain = value => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const keysEqual = (value, keys) => plain(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const hashPattern = /^[a-f0-9]{64}$/;
const maxArtifactBytes = 16 * 1024 * 1024;
const maxTotalBytes = 64 * 1024 * 1024;
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function validateArtifacts(artifacts) {
  if (!(artifacts instanceof Map) || artifacts.size !== artifactNames.length) fail();
  let total = 0;
  for (const [name, bytes] of artifacts) {
    if (!artifactNames.includes(name) || !Buffer.isBuffer(bytes)
      || bytes.length === 0 || bytes.length > maxArtifactBytes) fail();
    total += bytes.length;
  }
  if (total > maxTotalBytes) fail();
}

export function makeManifest(artifacts) {
  validateArtifacts(artifacts);
  return {
    format: "synthetic-backup-v1", scope: "synthetic-only", cliVersion,
    artifacts: artifactNames.map(name => ({ name, bytes: artifacts.get(name).length, sha256: sha256(artifacts.get(name)) })),
  };
}

// The expected manifest must be retained separately or authenticated by encryption.
// A checksum stored alongside attacker-controlled bytes does not authenticate them.
export function verifyArtifacts(manifest, artifacts) {
  validateArtifacts(artifacts);
  if (!keysEqual(manifest, ["format", "scope", "cliVersion", "artifacts"])
    || manifest.format !== "synthetic-backup-v1" || manifest.scope !== "synthetic-only"
    || manifest.cliVersion !== cliVersion || !Array.isArray(manifest.artifacts)
    || manifest.artifacts.length !== artifactNames.length) fail();
  manifest.artifacts.forEach((entry, index) => {
    if (!keysEqual(entry, ["name", "bytes", "sha256"]) || entry.name !== artifactNames[index]
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > maxArtifactBytes
      || typeof entry.sha256 !== "string" || !hashPattern.test(entry.sha256)) fail();
    const bytes = artifacts.get(entry.name);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail();
  });
  return true;
}

export function restoreInputs(manifest, artifacts) {
  verifyArtifacts(manifest, artifacts);
  return restoreSqlNames.map(name => ({ name, bytes: Buffer.from(artifacts.get(name)) }));
}

// Fixed synthetic fixture identifiers; no dynamic object paths or external URLs.
export function assertConsistent(before, after) {
  const keys = ["database", "auth", "storage", "references"];
  for (const snapshot of [before, after]) {
    if (!keysEqual(snapshot, keys) || keys.some(key => typeof snapshot[key] !== "string" || !hashPattern.test(snapshot[key]))) fail();
  }
  if (keys.some(key => before[key] !== after[key])) fail();
  // Necessary drift test, not proof of an atomic snapshot or a verified write freeze.
  return true;
}

export function safeResult(stage, status) {
  return {
    stage: stages.includes(stage) ? stage : "unknown",
    status: statuses.includes(status) ? status : "unverified",
  };
}

export function verifyTestResults(report) {
  try {
    const assertions = report.testResults.flatMap(file => file.assertionResults);
    return report.success === true && report.numTotalTests === caseNames.length
      && report.numPassedTests === caseNames.length && report.numFailedTests === 0
      && report.numPendingTests === 0 && report.numTodoTests === 0
      && assertions.length === caseNames.length
      && caseNames.every(name => assertions.filter(item => item.title === name && item.status === "passed").length === 1);
  } catch { return false; }
}

export function safeTestResults(report) {
  let assertions = [];
  try {
    if (Array.isArray(report?.testResults) && report.testResults.length <= caseNames.length) {
      assertions = report.testResults.flatMap(file => Array.isArray(file?.assertionResults) ? file.assertionResults : []);
    }
  } catch { /* Never print report content or exceptions. */ }
  return caseNames.map(name => {
    const matched = assertions.filter(item => item?.title === name);
    const status = matched.length === 1 ? matched[0].status : null;
    return { case: name, status: status === "passed" ? "verified" : status === "failed" ? "failed" : "unverified" };
  });
}

// Standard authenticated encryption for the synthetic harness only, not a new
// Production backup format. The random key stays in process memory, separate from
// the ciphertext. No password KDF, credentials or caller-selected paths are used.
const archiveAad = Buffer.from("synthetic-backup-v1/aes-256-gcm");
export function sealArtifacts(artifacts, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  const manifest = makeManifest(artifacts);
  const plaintext = Buffer.from(JSON.stringify({ manifest, files: artifactNames.map(name => [name, artifacts.get(name).toString("base64")]) }));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(archiveAad);
  try { return Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]); }
  finally { plaintext.fill(0); }
}
export function openArtifacts(ciphertext, key) {
  let plaintext;
  try {
    if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(ciphertext)
      || ciphertext.length < 29 || ciphertext.length > 96 * 1024 * 1024) fail();
    const decipher = createDecipheriv("aes-256-gcm", key, ciphertext.subarray(0, 12));
    decipher.setAAD(archiveAad); decipher.setAuthTag(ciphertext.subarray(-16));
    // Do not parse or expose plaintext until authentication succeeds.
    plaintext = Buffer.concat([decipher.update(ciphertext.subarray(12, -16)), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    if (!keysEqual(parsed, ["manifest", "files"]) || !Array.isArray(parsed.files) || parsed.files.length !== artifactNames.length) fail();
    const files = new Map();
    parsed.files.forEach((entry, index) => {
      if (!Array.isArray(entry) || entry.length !== 2 || entry[0] !== artifactNames[index]
        || typeof entry[1] !== "string" || entry[1].length > 24 * 1024 * 1024) fail();
      const bytes = Buffer.from(entry[1], "base64");
      if (bytes.toString("base64") !== entry[1]) fail();
      files.set(entry[0], bytes);
    });
    verifyArtifacts(parsed.manifest, files);
    return { manifest: parsed.manifest, files };
  } catch { fail(); }
  finally { plaintext?.fill(0); }
}
