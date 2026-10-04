import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve("src/App.tsx"), "utf8");
const repository = readFileSync(resolve("src/data/resumeRepository.ts"), "utf8");
const worker = readFileSync(resolve("src/worker/index.ts"), "utf8");

describe("Awards mode-aware save routing contract", () => {
  it("obtains the target-scoped server state and fails closed when RPC prerequisites are absent", () => {
    expect(repository).toContain('supabase.rpc("load_admin_awards_write_state", { target_resume_id: resumeId })');
    expect(app).toContain("repository.loadAdminAwardsWriteState(resumeId)");
    expect(app).toContain("awardsWriteState.awardsWriteMode === \"rpc\" && (!awardsWriteState.activityLogEnabled || !awardsWriteState.awardsTrustedContextRequired)");
  });
  it("routes RPC-mode saves to the Worker before generic direct writes and has no fallback branch", () => {
    const rpcSave = app.indexOf('section === "awards" && awardsWriteState?.awardsWriteMode === "rpc"');
    const firstDirectWrite = app.indexOf("repository.deleteEditableTranslation!(section", rpcSave);
    expect(rpcSave).toBeGreaterThan(-1);
    expect(firstDirectWrite).toBeGreaterThan(rpcSave);
    expect(app.slice(rpcSave, firstDirectWrite)).toContain("repository.saveAwardsWithWorker!(resumeId, working.draft as AwardItem[])");
    expect(worker).toContain('const SAVE_AWARDS_PATH = `${API_ROOT}/awards/save`');
    expect(worker).toContain("save_resume_awards_v1");
    const awardsHandler = worker.slice(worker.indexOf("async function saveAwards"), worker.indexOf("function isApiPath"));
    expect(awardsHandler).not.toContain("reportV13BFailure");
  });
  it("keeps ambiguous exact request state bounded in session storage and does not auto-submit it", () => {
    expect(repository).toContain("admin-awards-rpc-pending-v1:");
    expect(repository).toContain("new TextEncoder().encode(raw).byteLength > 8192");
    expect(repository).toContain("Retry the exact pending Awards request");
    expect(repository).not.toContain("globalThis.fetch(awardsStorageKey");
  });
});
