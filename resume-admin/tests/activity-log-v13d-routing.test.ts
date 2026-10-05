import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve("src/App.tsx"), "utf8");
const repository = readFileSync(resolve("src/data/resumeRepository.ts"), "utf8");
const worker = readFileSync(resolve("src/worker/index.ts"), "utf8");

describe("V1.3D-2 typed Experience and Skills save routing", () => {
  it.each([
    ["Experience", "experience", "saveExperienceWithWorker", "/experience/save"],
    ["Skills", "skills", "saveSkillsWithWorker", "/skills/save"],
  ])("loads %s target state and routes rpc mode only through its typed Worker boundary", (label, domain, saveMethod, endpoint) => {
    const stateMethod = `loadAdmin${label}WriteState`;
    const modeState = `${domain}WriteState`;
    expect(repository).toContain(`supabase.rpc("load_admin_${domain}_write_state", { target_resume_id: resumeId })`);
    expect(app).toContain(`repository.${stateMethod}(resumeId)`);
    expect(app).toContain(`${modeState}.resumeId !== resumeId`);
    expect(app).toContain(`${modeState}.writeMode === "rpc" && (!${modeState}.activityLogEnabled || !${modeState}.trustedContextRequired)`);
    const rpcBranch = app.indexOf(`section === "${domain}" && ${modeState}?.writeMode === "rpc"`);
    const genericWrite = app.indexOf("repository.deleteEditableTranslation!(section", rpcBranch);
    expect(rpcBranch).toBeGreaterThan(-1);
    expect(genericWrite).toBeGreaterThan(rpcBranch);
    expect(app.slice(rpcBranch, genericWrite)).toContain(`repository.${saveMethod}!(resumeId`);
    expect(worker).toContain(`const SAVE_${domain.toUpperCase()}_PATH = \`${"${API_ROOT}"}${endpoint}\``);
    expect(worker).toContain("save_resume_${domain}_v1");
    expect(worker).toContain("canonical_${collectionKey}");
  });

  it("keeps Experience and Skills independently idempotent and fails closed without direct fallback", () => {
    expect(repository).toContain('"experience"');
    expect(repository).toContain('"skills"');
    expect(repository).toContain('`admin-${domain}-rpc-pending-v1:${resumeId}`');
    expect(repository).toContain("Retry the exact pending request.");
    expect(worker).toContain('domain: "introduction" | "awards" | "experience" | "skills"');
    expect(worker).toContain("isV13BIdempotencyConflict(upstream, responseBody)");
    expect(worker).not.toMatch(/save_resume_(?:experience|skills)_v1[\s\S]{0,500}reportV13BFailure/);
  });

  it("keeps section titles outside each transactional collection writer and acknowledges partial outcomes", () => {
    expect(app).toContain("const sectionTextSaved = sectionText ? await sectionText.save() : true");
    expect(app).toContain("Experience content saved. The section title remains unsaved; retry to finish.");
    expect(app).toContain("Skills content saved. The section title remains unsaved; retry to finish.");
  });
});
