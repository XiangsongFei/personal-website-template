import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout, clearTimeout } from "node:timers";
// Test-only frozen candidate inputs. These are not a Production schema assertion.
export const candidateWorkerSha = "a7f1f6adf75256fa24c7958e30e74d9b774d8b21";
export const approvedMainSha = "33ad6f49d9ce940fd694c6a3c84cbb98f039ac6e";
export const migrations = [
  ["20261109000000_awards_baseline_pending_safety.sql", "d0670714fb14f8a8d64a17a6c7d6bf213d58e530d2c2c308e8869e8f22fe62b0"],
  ["20261110000000_restore_awards_writer_compatibility.sql", "bf278958011c339c2d2deb73f0a7227992d338ce568ed4ffe8bdceaaca2be622"],
  ["20261111000000_awards_idempotency_result_array.sql", "c7908d79ae37ba1e382cf7fe29f291a01daffd310bc28f267ccf7b11b451f385"],
  ["20261112000000_awards_jsonb_object_validation.sql", "c11f7c74c99c4a229bfd41214e2ee4f2452ae1bb79928987089f42ab7a2c7c35"],
  ["20261113000000_skills_baseline_cas.sql", "f00d6689ac757530221db13bc231986474d01b8ce16fa917116362572e0f29bb"],
  ["20261114000000_activity_log_section_titles.sql", "e0d4dab30a18fea5c07f58f39ad04e197ddcb90486ea3b987bacb192242744d2"],
  ["20261115000000_files_restore_qa_reference_compatibility.sql", "66a84a7c9e0510bd68dd08ad68489dd34d9c4316f3230095410677a06a83de30"],
];
export const candidateMigrationNames = migrations.map(([name]) => name);
// Historical synthetic schema, not a Production schema snapshot.
export const candidateSchemaSha = "a7f1f6adf75256fa24c7958e30e74d9b774d8b21";
export const candidateHistoricalExclusions = Object.freeze(["20261031130000_test_profile_signing_probe.sql", "20261031140000_retire_test_profile_signing_probe.sql", "20261103000000_education_experience_test_rpc_routing.sql"]);
export const candidateBaselineMigrations = Object.freeze([
  Object.freeze(["20260929000000_test_only_vault_extension.sql", "54f8741a8fe5244b725190c90eb818148871cbec7cfaf3120698a8a4d431c8c1"]),
  Object.freeze(["20260930000000_test_only_schema_bootstrap.sql", "5da521bd9922a03597cedcd00600de4887901d654a5fde5dfed3efb55b10650f"]),
  Object.freeze(["20261001000000_scoped_admin_access.sql", "41665e267767c76d78be24c7eb839977e3af80755eac5f8aa16b6767034bc54e"]),
  Object.freeze(["20261002000000_activity_log_foundation.sql", "643b04a5ca134d5be41d73af118a72886320965e6f2b59b04754d9bef098471d"]),
  Object.freeze(["20261003000000_activity_log_phase1_introduction.sql", "824f28533336505b5a60c2ecd6bae5ab2234e0a2ca7b5afadd64db781cc797be"]),
  Object.freeze(["20261004000000_activity_log_phase1_introduction_conflict_target.sql", "cf5bab463a6e964004f230e5b5b40f16d802eeb7327cf8637c554de41d8c4671"]),
  Object.freeze(["20261005000000_activity_log_v11_context.sql", "a26835c1a05c06c339a14f6b521fc2548be685d09f814233296c009e4daae794"]),
  Object.freeze(["20261005000001_test_only_v11_key_provider.sql", "e488e38b731a1adb85b420176dcf8dd5b0716bdcf2178cbc258c317036044461"]),
  Object.freeze(["20261006000000_activity_log_v11_vault_key_adapter.sql", "b69a741873650a6d361eeea43e70c13097ddce884c0d66b511b21e65cc5b63c6"]),
  Object.freeze(["20261006000001_test_only_v11_vault_key.sql", "88936c51d0627e91caa5756a5ccce022b900bedd4416952e0a7b481ed2f0cd7d"]),
  Object.freeze(["20261007000000_activity_log_v11_read_metadata.sql", "3a987983cf5ec7e80b299ac660c5f823b44b6bd4ab23fe1114d06ea89ef787b7"]),
  Object.freeze(["20261008000000_activity_log_v12_filters.sql", "7825a23eb22f66839e781ec0c39855471fc0174ae6db3f8443321f42a7c67104"]),
  Object.freeze(["20261009000000_activity_log_v13_system_events.sql", "7d69bf41628fa9dd2a4a5bea20a79a49ba667c226c57bc17048b71edb8a6e79a"]),
  Object.freeze(["20261009000001_test_only_v13_failure_key.sql", "c9f577fdf5dcf265970dbe99c5d1390fbaaa8a2d53bada5da8e5bc30fd8b6c6b"]),
  Object.freeze(["20261010000000_activity_log_v13b_failure_contract.sql", "562afba0812d85f3a22e0c206a498bb02dc8deb9fff558c2ba696d7320d3ede5"]),
  Object.freeze(["20261011000000_activity_log_v13c_unified_read.sql", "413a29050b1bfdcd909174f37a485681f8a7dc44db5826bd5cf5a8bfaf05bf34"]),
  Object.freeze(["20261012000000_activity_log_collection_v2.sql", "9db784a2edd8f569dd9a4c818e11466b4b08c10e21bd420f37713238b9c3fce7"]),
  Object.freeze(["20261013000000_activity_log_awards_writer.sql", "793292ec39f00dbe34e2db6f3ffd747d62515cb755a146c599cd7e1271c2a48e"]),
  Object.freeze(["20261014000000_activity_log_v2_experience_skills.sql", "104994df1db9206878c0c99761f3a06ff90bf864a2262eeb2193a8889d22281c"]),
  Object.freeze(["20261015000000_activity_log_experience_writer.sql", "d8d6dfdb2d406c5b81789cfbbc8445b3087ab9b3396c0027c5b95782fe98a328"]),
  Object.freeze(["20261016000000_activity_log_skills_writer.sql", "9498c9663464a15134f044ca36eadcb4aec8dcdf743ce7f84b19d00a5140856b"]),
  Object.freeze(["20261017000000_activity_log_v2_education.sql", "f8ad6c4588f1a5a73ba9993063951ffa874632642716fb8f62866915914274b4"]),
  Object.freeze(["20261018000000_activity_log_education_writer.sql", "2d2ce2cab353381624c8391037b4525153aa30ec0a8f47eea93e01088e6a09c3"]),
  Object.freeze(["20261019000000_activity_log_v2_projects.sql", "e0a33cd4ec2ebe9fdac0d5b980100bccf99369f63b69eef76aa09d4d2d85b2db"]),
  Object.freeze(["20261020000000_activity_log_projects_writer.sql", "c626d8ad5ccb738f646b4d82e917c7dd5480a4ae6d49a13bdb6df9e999516d5f"]),
  Object.freeze(["20261021000000_activity_log_contact_writer.sql", "d9584e732eb8ddeab985e5735b32e6e51295dd83a1d07d9dc60397868287edf0"]),
  Object.freeze(["20261022000000_activity_log_contact_writer.sql", "603dcff37876d5f2743e5fae42e06f2128a27c8522412e356467ecccbc48636f"]),
  Object.freeze(["20261023000000_activity_log_contact_writer_conflict_target.sql", "abef21c6183bd21eb6f2fd2091f9d4f92ca9956b96d0ba2578019c3ddc2aaa18"]),
  Object.freeze(["20261024000000_activity_log_profile_writer.sql", "7741588156a15523f93d90a7e143f5bfc45d0f081a970c5793b77d1bf4545f04"]),
  Object.freeze(["20261025000000_activity_log_website_links_writer.sql", "020de6b9e4a54332699fb2ef3898c7b5d343fe13f9755977bc5a3324d4973d4d"]),
  Object.freeze(["20261026000000_activity_log_files_writer.sql", "fdc45b7c9d3f1e4c59a2a59cbc453778ca272c5b709872f29255b3cce6476154"]),
  Object.freeze(["20261027000000_activity_log_files_legacy_restore.sql", "598a56fa2389afc596516c380eb9f4a28859416e93618fff9064b9343ebc8cee"]),
  Object.freeze(["20261028000000_activity_log_files_storage_authorization.sql", "f5d2d4915be47feca56d0bcd208e41393891776409607b53aa7fc057551751dc"]),
  Object.freeze(["20261029000000_version_history_v1_read.sql", "2bd2e5c16886c0028450e9a17b6b922f8b7f4cb81968c8f19ffec239e344ec91"]),
  Object.freeze(["20261030000000_activity_log_restore_v1.sql", "ea5f4d4f7f31446c5dedddba874c808590107aaac96f04e8d512913ca620defe"]),
  Object.freeze(["20261031000000_restore_replay_safe_domain_resolver.sql", "4631ab9afb9bbd6a870186e4d9e94ffbc71b4466f96f1c9cde1a88c4a1c32101"]),
  Object.freeze(["20261031110000_test_only_installed_baseline_delta.sql", "a6312ca5d120eb8f3e3d08f43bd7b4e256d25c58b555a3b8ce61a1d89964ba56"]),
  Object.freeze(["20261031120001_p0_identity_scoped_activity_log.sql", "da5a755e903a10693e7c5ba3924afaf0218aec156f8d86421e3aba2819186950"]),
  Object.freeze(["20261031150000_profile_image_history_retention.sql", "089c08a2da05bb881368faedb4d078a39f26d456d78c0f39381959be567212d3"]),
  Object.freeze(["20261101000000_files_restore_capability_enforcement.sql", "8399ca4c280b05b83dc9385d40dec3fdee03ec4d025f351a5c1ce7e8d0f54875"]),
  Object.freeze(["20261102000000_introduction_version_history_read.sql", "5bf3e2b6b024162064b5eeddaea81b3220fab13e3fe0ee03664616387f5ae5f4"]),
  Object.freeze(["20261102500000_test_only_rename_activity_log_test_target.sql", "dfed69bc1d1bfe2f64152db5cf9e84ffd4467f6a316972bdb5dbc083255a34a8"]),
]);
export function verifyCandidateMigrationFiles(entries) {
  const names = entries.map(([name]) => name);
  assert.deepEqual(names, candidateBaselineMigrations.map(([name]) => name), "Candidate migration names/order differ");
  assert.equal(new Set(names.map(name => name.slice(0, 14))).size, names.length, "Duplicate migration version");
  for (let i = 0; i < entries.length; i++) {
    assert.equal(createHash("sha256").update(entries[i][1]).digest("hex"), candidateBaselineMigrations[i][1], "Candidate migration content differs");
  }
}
export function stageCandidateMigrations(source, destination) {
  // Unknown future source files fail closed; they are never copied into the baseline.
  const expectedSource = [...candidateBaselineMigrations.map(([name]) => name), ...candidateHistoricalExclusions, ...candidateMigrationNames].sort();
  assert.deepEqual(readdirSync(source).sort(), expectedSource, "Candidate source migration inventory drift");
  const entries = candidateBaselineMigrations.map(([name]) => [name, readFileSync(join(source, name))]);
  verifyCandidateMigrationFiles(entries);
  mkdirSync(destination);
  for (const [name, bytes] of entries) writeFileSync(join(destination, name), bytes, { flag: "wx" });
  verifyCandidateMigrationFiles(readdirSync(destination).sort().map(name => [name, readFileSync(join(destination, name))]));
}

export const caseNames = ["awards", "skills", "section-titles", "files-reference", "authorization"];
export const combinations = ["old-db-old-worker", "old-db-new-worker", "new-db-old-worker", "new-db-new-worker"];
function assertionRows(report) {
  if (!Array.isArray(report?.testResults)) return [];
  return report.testResults.flatMap(x => Array.isArray(x?.assertionResults) ? x.assertionResults : []);
}
export function verifiedResults(report) {
  const rows = assertionRows(report);
  return report?.success === true && report.numTotalTests === caseNames.length
    && report.numPassedTests === caseNames.length && report.numFailedTests === 0 && report.numPendingTests === 0
    && Array.isArray(rows) && rows.length === caseNames.length
    && caseNames.every(name => rows.filter(x => x?.title === name && x.status === "passed").length === 1);
}
export function safeResults(report) {
  const rows = assertionRows(report);
  return caseNames.map(name => {
    const matching = rows.filter(x => x?.title === name);
    return { name, status: matching.length === 1 && ["passed", "failed", "pending", "skipped"].includes(matching[0].status) ? matching[0].status : "unverified" };
  });
}

// Child is a detached process group. Caller retains ownership-checked cleanup.
export function waitBoundedChild(child, timeoutMs, killGroup) {
  return new Promise(resolveExit => {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    const done = code => { clearTimeout(timer); resolveExit({ code, timedOut }); };
    child.once("error", () => done(null));
    child.once("close", done);
  });
}


export const candidateStages = ["candidate-git", "candidate-archive", "candidate-extract", "candidate-build", "candidate-metadata", "unknown"];
export function safeStageResult(stage, status) {
  return candidateStages.includes(stage) && ["success", "failed", "unverified"].includes(status)
    ? { stage, status } : { stage: "unknown", status: "unverified" };
}
export async function candidateStep(stage, operation, emit) {
  try { const value = await operation(); emit(safeStageResult(stage, "success")); return value; }
  catch (error) { emit(safeStageResult(stage, "failed")); throw error; }
}

// Staging preserves callback error identity only after verified resource cleanup.
export async function observeCompatibilityStaging(stageRunner, callback, emit) {
  let callbackError, callbackFailed = false, callbackExited = false;
  try {
    await stageRunner(async (...args) => {
      try { const result = await callback(...args); emit("callback", "success"); return result; }
      catch (error) { callbackError = error; callbackFailed = true; emit("callback", "failed"); throw error; }
      finally { callbackExited = true; }
    });
    emit("resources", "success");
  } catch (error) {
    if (!callbackExited) emit("callback", "unverified");
    emit("resources", !callbackExited ? "unverified" : callbackFailed && error === callbackError ? "success" : "failed");
    throw error;
  }
}

// Diagnostic-only observer: exceptions and return values are preserved verbatim.
export const stagingDiagnosticPhases = Object.freeze([
  "environment-preflight", "baseline-preparation", "port-reservation", "resource-snapshot",
  "image-verification", "network-creation", "manifest-creation", "manifest-delivery",
  "startup-observation", "supabase-start", "ownership-verification", "endpoint-verification",
  "cleanup", "directory-finalization",
]);
export function safeStagingDiagnostic(record = {}) {
  const value = record && typeof record === "object" ? record : {};
  return {
    phase: stagingDiagnosticPhases.includes(value.phase) ? value.phase : "unknown",
    status: ["success", "failed", "unverified", "not-needed"].includes(value.status) ? value.status : "unverified",
    resources: ["not-created", "created", "unverified"].includes(value.resources) ? value.resources : "unverified",
    manifest: ["not-created", "created", "unverified"].includes(value.manifest) ? value.manifest : "unverified",
  };
}
export function createStagingDiagnostics(report) {
  let resources = "not-created", manifest = "not-created";
  const mark = (phase, status) => {
    // Diagnostics must not alter startup, errors or cleanup when IPC is unavailable.
    try { report(safeStagingDiagnostic({ phase, status, resources, manifest })); } catch { /* no evidence delivered */ }
  };
  const failed = (phase, error) => { mark(phase, "failed"); throw error; };
  return {
    mark,
    resourceAttempt() { resources = "unverified"; },
    resourceCreated() { resources = "created"; },
    manifestCreated() { manifest = "created"; },
    step(phase, operation) {
      mark(phase, "unverified");
      try { const result = operation(); mark(phase, "success"); return result; }
      catch (error) { return failed(phase, error); }
    },
    async stepAsync(phase, operation) {
      mark(phase, "unverified");
      try { const result = await operation(); mark(phase, "success"); return result; }
      catch (error) { return failed(phase, error); }
    },
  };
}
