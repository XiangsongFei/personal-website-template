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
