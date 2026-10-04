import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository, type ActivityLogFilters, type ActivityLogV13CFilters } from "../src/data/resumeRepository";

function repository(rpc: ReturnType<typeof vi.fn>) {
  return createResumeRepository({ rpc, from: vi.fn() } as unknown as SupabaseClient);
}

describe("Activity Log repository RPC boundary", () => {
  const v13cFilters: ActivityLogV13CFilters = {
    eventFilter: "all", section: "", operation: "", actorEmail: "", dateFrom: null, dateToExclusive: null, search: "",
  };
  const activityRow = (overrides: Record<string, unknown> = {}) => ({
    event_source: "activity", source_rank: 1, id: "event-v13c", occurred_at: "2026-10-02T10:00:00Z",
    actor_email_snapshot: "qa@example.test", actor_role_snapshot: "qa", operation: "update", section_key: "introduction",
    entity_type: "introduction_paragraph", entity_id: "intro-1", entity_snapshot: { position: 1 },
    changes: { text_zh: { before: "旧", after: "新" } }, payload_version: 1,
    event_kind: null, outcome: null, failure_stage: null, failure_code: null, request_id: null,
    ip_network: "188.253.112.0/24", country_code: "HK", region: null, city: "Hong Kong", ...overrides,
  });
  const rejectedRow = (overrides: Record<string, unknown> = {}) => ({
    event_source: "system", source_rank: 2, id: "event-rejected", occurred_at: "2026-10-02T11:00:00Z",
    actor_email_snapshot: "qa@example.test", actor_role_snapshot: "qa", operation: "update", section_key: "introduction",
    entity_type: null, entity_id: null, entity_snapshot: null, changes: null, payload_version: null,
    event_kind: "operation_failure", outcome: "rejected", failure_stage: "idempotency",
    failure_code: "idempotency_conflict", request_id: "request-1",
    ip_network: null, country_code: null, region: null, city: null, ...overrides,
  });
  it("loads target-scoped server-owned capability and Introduction mode", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ activity_log_enabled: true, introduction_write_mode: "rpc", introduction_trusted_context_required: false }], error: null });
    await expect(repository(rpc).loadAdminFeatureState!("qa-target")).resolves.toEqual({ resumeId: "qa-target", activityLogEnabled: true, introductionWriteMode: "rpc", introductionTrustedContextRequired: false });
    expect(rpc).toHaveBeenCalledWith("load_admin_feature_state_v11", { target_resume_id: "qa-target" });
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
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "event-1", occurred_at: "2026-10-02T10:00:00Z", actor_email_snapshot: "qa@example.test", actor_role_snapshot: "qa", operation: "update", section_key: "introduction", entity_type: "introduction_paragraph", entity_id: "introduction", entity_snapshot: { paragraphs: [] }, changes: { text_zh: { before: [{ id: "p1", value: "前" }], after: [{ id: "p1", value: "后" }] } }, ip_network: "188.253.112.0/24", country_code: "HK", region: null, city: "Hong Kong" }], error: null });
    const cursor = { occurredAt: "2026-10-01T10:00:00Z", id: "event-0" };
    const events = await repository(rpc).loadActivityLogPage!("qa-target", 25, cursor);
    expect(events[0]).toMatchObject({ id: "event-1", actorRole: "qa", actorEmail: "qa@example.test", ipNetwork: "188.253.112.0/24", countryCode: "HK", region: null, city: "Hong Kong", changes: { text_zh: { before: [{ id: "p1", value: "前" }], after: [{ id: "p1", value: "后" }] } } });
    expect(rpc).toHaveBeenCalledWith("read_activity_log_events", {
      target_resume_id: "qa-target", page_limit: 25, before_occurred_at: cursor.occurredAt, before_id: cursor.id,
    });
  });

  it("normalizes absent optional metadata from an older RPC response to null", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "event-legacy", occurred_at: "2026-10-02T10:00:00Z", actor_email_snapshot: null, actor_role_snapshot: "owner", operation: "update", section_key: "introduction", entity_type: "introduction_paragraph", entity_id: null, entity_snapshot: {}, changes: {} }], error: null });
    await expect(repository(rpc).loadActivityLogPage!("qa-target", 25)).resolves.toMatchObject([
      { ipNetwork: null, countryCode: null, region: null, city: null },
    ]);
  });

  it("calls the V1.2 RPC with explicit filter and cursor argument mapping", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "v12", occurred_at: "2026-10-02T10:00:00Z", actor_email_snapshot: "qa@example.test", actor_role_snapshot: "qa", operation: "upload", section_key: "files", entity_type: "resume_file", entity_id: "resume.pdf", entity_snapshot: {}, changes: {}, ip_network: null, country_code: null, region: null, city: null }], error: null });
    const filters: ActivityLogFilters = { section: "files", operation: "upload", actorEmail: " qa@example.test ", dateFrom: "2026-10-01T16:00:00.000Z", dateToExclusive: "2026-10-02T16:00:00.000Z", search: "report%_\\" };
    const cursor = { occurredAt: "2026-10-01T12:00:00Z", id: "event-cursor" };
    await expect(repository(rpc).loadActivityLogPageV12!("qa-target", 25, filters, cursor)).resolves.toMatchObject([
      { id: "v12", section: "files", operation: "upload", ipNetwork: null, city: null },
    ]);
    expect(rpc).toHaveBeenCalledWith("read_activity_log_events_v12", {
      target_resume_id: "qa-target", page_limit: 25, before_occurred_at: cursor.occurredAt, before_id: cursor.id,
      section_filter: "files", operation_filter: "upload", actor_email_filter: "qa@example.test",
      date_from: filters.dateFrom, date_to_exclusive: filters.dateToExclusive, search_query: "report%_\\",
    });
  });

  it("calls the V1.3C RPC with exact first-page arguments and maps successful activity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [activityRow()], error: null });
    const events = await repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters);
    expect(events[0]).toMatchObject({
      eventSource: "activity", sourceRank: 1, id: "event-v13c", actorRole: "qa", section: "introduction",
      entityType: "introduction_paragraph", entityId: "intro-1", changes: { text_zh: { before: "旧", after: "新" } },
    });
    expect(rpc).toHaveBeenCalledWith("read_activity_log_events_v13c", {
      target_resume_id: "qa-target", page_limit: 25, before_occurred_at: null, before_id: null, before_source_rank: null,
      event_filter: "all", section_filter: null, operation_filter: null, actor_email_filter: null,
      date_from: null, date_to_exclusive: null, search_query: null,
    });
  });

  it("propagates all event filters and all three continuation cursor fields", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [activityRow()], error: null });
    const filters: ActivityLogV13CFilters = {
      eventFilter: "rejected", section: "introduction", operation: "update", actorEmail: " qa@example.test ",
      dateFrom: "2026-10-01T16:00:00.000Z", dateToExclusive: "2026-10-02T16:00:00.000Z", search: " conflict ",
    };
    const cursor = { occurredAt: "2026-10-01T12:00:00Z", id: "event-cursor", sourceRank: 2 as const };
    await repository(rpc).loadActivityLogPageV13C!("qa-target", 25, filters, cursor);
    expect(rpc).toHaveBeenCalledWith("read_activity_log_events_v13c", {
      target_resume_id: "qa-target", page_limit: 25, before_occurred_at: cursor.occurredAt,
      before_id: cursor.id, before_source_rank: 2, event_filter: "rejected",
      section_filter: "introduction", operation_filter: "update", actor_email_filter: "qa@example.test",
      date_from: filters.dateFrom, date_to_exclusive: filters.dateToExclusive, search_query: "conflict",
    });
  });

  it.each(["all", "successful", "rejected"] as const)("propagates event_filter=%s", async eventFilter => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await repository(rpc).loadActivityLogPageV13C!("qa-target", 25, { ...v13cFilters, eventFilter });
    expect(rpc).toHaveBeenCalledWith("read_activity_log_events_v13c", expect.objectContaining({ event_filter: eventFilter }));
  });

  it("maps rejected rows without synthesizing entity or diff information", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [rejectedRow()], error: null });
    const [event] = await repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters);
    expect(event).toMatchObject({ eventSource: "system", sourceRank: 2, eventKind: "operation_failure", outcome: "rejected", failureStage: "idempotency", failureCode: "idempotency_conflict", requestId: "request-1" });
    expect(event.entityType).toBeNull();
    expect(event.entityId).toBeNull();
    expect(event.entitySnapshot).toBeNull();
    expect(event.changes).toBeNull();
    expect("changes" in event && event.changes).toBeNull();
  });

  it.each([
    ["activity source rank", activityRow({ source_rank: 2 })],
    ["system source rank", rejectedRow({ source_rank: 1 })],
    ["system event kind", rejectedRow({ event_kind: "system_change" })],
    ["system outcome", rejectedRow({ outcome: "applied" })],
    ["system fabricated diff", rejectedRow({ changes: {} })],
    ["unknown source", activityRow({ event_source: "future" })],
    ["malformed activity row", activityRow({ changes: { text: { before: "missing after" } } })],
  ])("fails closed for unexpected %s", async (_description, row) => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    await expect(repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).rejects.toThrow("Invalid Activity Log response");
  });
});
