import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository } from "../src/data/resumeRepository";

function repository(rpc: ReturnType<typeof vi.fn>) {
  return createResumeRepository({ rpc, from: vi.fn() } as unknown as SupabaseClient);
}

describe("Activity Log repository RPC boundary", () => {
  it("loads target-scoped server-owned capability and Introduction mode", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ activity_log_enabled: true, introduction_write_mode: "rpc" }], error: null });
    await expect(repository(rpc).loadAdminFeatureState!("qa-target")).resolves.toEqual({ activityLogEnabled: true, introductionWriteMode: "rpc" });
    expect(rpc).toHaveBeenCalledWith("load_admin_feature_state", { target_resume_id: "qa-target" });
  });

  it("obtains Activity Log targets only through the existing authorization RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resume_id: "qa-target", site_key: "example-cv-qa", role: "qa" }], error: null });
    await expect(repository(rpc).loadActivityLogAuthorizedTargets!()).resolves.toEqual([
      { resumeId: "qa-target", siteKey: "example-cv-qa", role: "qa" },
    ]);
    expect(rpc).toHaveBeenCalledWith("activity_log_authorized_targets");
  });

  it("uses the typed atomic Introduction RPC and returns its canonical persisted rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "persisted-id", position: 4, translations: { zh: { text: "已保存" }, en: { text: "Saved" } } }], error: null });
    const draft = [{ id: "local-1-2", position: 0, translations: { zh: { text: "草稿" }, en: { text: "Draft" } } }];
    await expect(repository(rpc).saveIntroductionAtomically!("qa-target", draft)).resolves.toEqual([
      { id: "persisted-id", position: 4, translations: { zh: { text: "已保存" }, en: { text: "Saved" } } },
    ]);
    expect(rpc).toHaveBeenCalledWith("save_resume_introduction", {
      target_resume_id: "qa-target", target_items: [{ id: "local-1-2", zh: "草稿", en: "Draft" }],
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("does not fall through to any direct table write when the RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("rpc denied") });
    const from = vi.fn();
    const repo = createResumeRepository({ rpc, from } as unknown as SupabaseClient);
    await expect(repo.saveIntroductionAtomically!("qa-target", [])).rejects.toThrow("Introduction changes could not be saved");
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("uses only the existing read RPC for keyset-paginated events", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "event-1", occurred_at: "2026-10-02T10:00:00Z", actor_email_snapshot: "qa@example.test", actor_role_snapshot: "qa", operation: "update", section_key: "introduction", entity_type: "introduction_paragraph", entity_id: "introduction", entity_snapshot: { paragraphs: [] }, changes: { text_zh: { before: [{ id: "p1", value: "前" }], after: [{ id: "p1", value: "后" }] } } }], error: null });
    const cursor = { occurredAt: "2026-10-01T10:00:00Z", id: "event-0" };
    const events = await repository(rpc).loadActivityLogPage!("qa-target", 25, cursor);
    expect(events[0]).toMatchObject({ id: "event-1", actorRole: "qa", actorEmail: "qa@example.test", changes: { text_zh: { before: [{ id: "p1", value: "前" }], after: [{ id: "p1", value: "后" }] } } });
    expect(rpc).toHaveBeenCalledWith("read_activity_log_events", {
      target_resume_id: "qa-target", page_limit: 25, before_occurred_at: cursor.occurredAt, before_id: cursor.id,
    });
  });
});
