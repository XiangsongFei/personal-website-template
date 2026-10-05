import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository, type ActivityLogFilters, type ActivityLogV13CFilters } from "../src/data/resumeRepository";

function repository(rpc: ReturnType<typeof vi.fn>) {
  return createResumeRepository({ rpc, from: vi.fn() } as unknown as SupabaseClient);
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it("accepts only the frozen Awards payload-v2 entity combination", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const award = { id, position: 0, zh: { name: "奖项", year: "2025" }, en: { name: "Award", year: "2025" } };
    const rpc = vi.fn().mockResolvedValue({ data: [activityRow({ section_key: "awards", entity_type: "award_list", entity_id: null,
      entity_snapshot: { awards: [award] }, changes: { awards: { before: [], after: [award] } }, payload_version: 2 })], error: null });
    await expect(repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).resolves.toMatchObject([{ payloadVersion: 2, entityType: "award_list" }]);
    const invalid = vi.fn().mockResolvedValue({ data: [activityRow({ entity_type: "award_list", payload_version: 1 })], error: null });
    await expect(repository(invalid).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).rejects.toThrow("Invalid Activity Log response");
  });

  it.each([
    ["experience", "experience_list", { organization: "Org", title: "Role", period: "2025", description: "Work", location: null }],
    ["skills", "skill_group_list", { title: "Languages", items: "English" }],
  ] as const)("accepts only the exact %s V2 collection projection", async (domain, entityType, locale) => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const row = { id, position: 0, zh: locale, en: locale };
    const rpc = vi.fn().mockResolvedValue({ data: [activityRow({ section_key: domain, entity_type: entityType, entity_id: null,
      entity_snapshot: { [domain]: [row] }, changes: { [domain]: { before: [], after: [row] } }, payload_version: 2 })], error: null });
    await expect(repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).resolves.toMatchObject([{ payloadVersion: 2, entityType }]);
    const malformed = vi.fn().mockResolvedValue({ data: [activityRow({ section_key: domain, entity_type: entityType, entity_id: null,
      entity_snapshot: { [domain]: [row] }, changes: { [domain]: { before: [], after: [{ ...row, extra: true }] } }, payload_version: 2 })], error: null });
    await expect(repository(malformed).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).rejects.toThrow("Invalid Activity Log response");
  });

  it("decodes Education V2 title updates with the frozen education_list snapshot shape", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const item = (title: string) => ({
      id, position: 0, entry_type: "summerSchool", education_category: null,
      zh: { title: "中文标题", program: "项目", period: "2025", grade: "", course_title: null, course_description: null, custom_category_label: null },
      en: { title, program: "Program", period: "2025", grade: "", course_title: null, course_description: null, custom_category_label: null },
    });
    const rows = [
      activityRow({ section_key: "education", entity_type: "education_list", entity_id: null,
        entity_snapshot: { education: [item("QA Sample Institute [V1.3D-3 QA TEMP]")] },
        changes: { education: { before: [item("QA Sample Institute")], after: [item("QA Sample Institute [V1.3D-3 QA TEMP]")] } }, payload_version: 2 }),
      activityRow({ id: "event-education-restore", section_key: "education", entity_type: "education_list", entity_id: null,
        entity_snapshot: { education: [item("QA Sample Institute")] },
        changes: { education: { before: [item("QA Sample Institute [V1.3D-3 QA TEMP]")], after: [item("QA Sample Institute")] } }, payload_version: 2 }),
    ];
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const events = await repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters);
    expect(events).toHaveLength(2);
    expect(events.map(event => event.changes?.education)).toEqual([
      { before: [item("QA Sample Institute")], after: [item("QA Sample Institute [V1.3D-3 QA TEMP]")] },
      { before: [item("QA Sample Institute [V1.3D-3 QA TEMP]")], after: [item("QA Sample Institute")] },
    ]);
  });

  it("accepts Projects V2 with sparse stored before-method positions and dense canonical after positions", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const method = (methodId: string, position: number, value: string) => ({ id: methodId, position, value });
    const project = (positions: number[]) => ({ id, position: 0,
      zh: { title: "项目", subtitle: "", period: "2024", description: "", href: "" },
      en: { title: "Project", subtitle: "", period: "2024", description: "", href: "" },
      methods: { zh: positions.map((position, i) => method(`${i === 2 ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc" : i === 1 ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "dddddddd-dddd-4ddd-8ddd-dddddddddddd"}`, position, `m${i}`)), en: [] },
    });
    const before = project([0, 1, 3]);
    const after = project([0, 1, 2]);
    const rpc = vi.fn().mockResolvedValue({ data: [activityRow({ section_key: "projects", entity_type: "project_list", entity_id: null,
      entity_snapshot: { projects: [after] }, changes: { projects: { before: [before], after: [after] } }, payload_version: 2 })], error: null });
    await expect(repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).resolves.toMatchObject([{ payloadVersion: 2, entityType: "project_list" }]);
    const malformedBefore = { ...before, methods: { ...before.methods, zh: before.methods.zh.map((row, index) => index === 2 ? { ...row, position: 1 } : row) } };
    const malformed = vi.fn().mockResolvedValue({ data: [activityRow({ section_key: "projects", entity_type: "project_list", entity_id: null,
      entity_snapshot: { projects: [after] }, changes: { projects: { before: [malformedBefore], after: [after] } }, payload_version: 2 })], error: null });
    await expect(repository(malformed).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).rejects.toThrow("Invalid Activity Log response");
  });

  it("decodes the exact Profile V2 aggregate and rejects malformed Profile snapshots", async () => {
    const profile = (name: string) => ({
      shared: { graduation_value: "2026", avatar_initials: "DU", footer_name: "Demo", copyright: "© Demo", photo_url: null },
      translations: Object.fromEntries(["zh", "en"].map(locale => [locale, {
        name, nav_about_label: "About", email_action_label: "Email", graduation_label: "Graduation", avatar_label: "Avatar",
        contact_focus_heading: "Focus", contact_status_heading: "Status",
      }])),
    });
    const before = profile("Old name"); const after = profile("New name");
    const row = activityRow({ section_key: "profile", entity_type: "profile_settings", entity_id: null,
      entity_snapshot: { profile: after }, changes: { profile: { before, after } }, payload_version: 2 });
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    await expect(repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).resolves.toMatchObject([
      { payloadVersion: 2, section: "profile", entityType: "profile_settings", changes: { profile: { before, after } } },
    ]);
    const malformed = vi.fn().mockResolvedValue({ data: [{ ...row, entity_snapshot: { profile: after, extra: true } }], error: null });
    await expect(repository(malformed).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).rejects.toThrow("Invalid Activity Log response");
  });

  it("fails closed for malformed Education V2 snapshots", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const item = { id, position: 0, entry_type: "summerSchool", education_category: null,
      zh: { title: "中文", program: "项目", period: "2025", grade: "", course_title: null, course_description: null, custom_category_label: null },
      en: { title: "English", program: "Program", period: "2025", grade: "", course_title: null, course_description: null, custom_category_label: null } };
    const rpc = vi.fn().mockResolvedValue({ data: [activityRow({ section_key: "education", entity_type: "education_list", entity_id: null,
      entity_snapshot: { education: [item] }, changes: { education: { before: [], after: [{ ...item, extra: true }] } }, payload_version: 2 })], error: null });
    await expect(repository(rpc).loadActivityLogPageV13C!("qa-target", 25, v13cFilters)).rejects.toThrow("Invalid Activity Log response");
  });
});

describe("Awards repository signed write routing", () => {
  const resumeId = "ea111111-1111-4111-8111-111111111111";
  const draft = [{ id: "local-1-1", position: 0, sourceKey: null,
    translations: { zh: { name: "本地草稿", year: "2025" }, en: { name: "Local draft", year: "2025" } } }];
  it("loads only target-scoped server write state", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resume_id: resumeId, activity_log_enabled: true, awards_write_mode: "rpc", awards_trusted_context_required: true }], error: null });
    await expect(repository(rpc).loadAdminAwardsWriteState!(resumeId)).resolves.toEqual({ resumeId, activityLogEnabled: true, awardsWriteMode: "rpc", awardsTrustedContextRequired: true });
    expect(rpc).toHaveBeenCalledWith("load_admin_awards_write_state", { target_resume_id: resumeId });
  });

  it("posts only to the Worker, returns canonical IDs, and retains the exact request for explicit retry after ambiguity", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const response = [{ id, position: 0, zh: { name: "本地草稿", year: "2025" }, en: { name: "Local draft", year: "2025" } }];
    const supabase = { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "session-token", expires_at: Date.now() / 1000 + 3600 } }, error: null })) } };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let failOnce = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (failOnce) { failOnce = false; throw new Error("lost response"); }
      return Response.json(response);
    }));
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    await expect(repo.saveAwardsWithWorker!(resumeId, draft)).rejects.toThrow("save result is uncertain");
    expect(repo.hasPendingAwardsWorkerSave!(resumeId)).toBe(true);
    const changedDraft = [{ ...draft[0]!, translations: { ...draft[0]!.translations, zh: { name: "changed after ambiguity", year: "2025" } } }];
    await expect(repo.saveAwardsWithWorker!(resumeId, changedDraft)).resolves.toMatchObject([{ id, position: 0 }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("/api/admin/v1/awards/save");
    expect(calls[0]!.body.request_id).toBe(calls[1]!.body.request_id);
    expect(calls[0]!.body.awards).toEqual(calls[1]!.body.awards);
    expect(calls[0]!.body.awards).toEqual([{ id: null, position: 0, zh: { name: "本地草稿", year: "2025" }, en: { name: "Local draft", year: "2025" } }]);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId)).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("Projects repository signed write routing", () => {
  const resumeId = "ea111111-1111-4111-8111-111111111111";
  it("loads target-scoped Projects mode and trusted-context state", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resume_id: resumeId, activity_log_enabled: true,
      projects_write_mode: "rpc", projects_trusted_context_required: true }], error: null });
    await expect(repository(rpc).loadAdminProjectsWriteState!(resumeId)).resolves.toEqual({ resumeId, domain: "projects",
      activityLogEnabled: true, writeMode: "rpc", trustedContextRequired: true });
    expect(rpc).toHaveBeenCalledWith("load_admin_projects_write_state", { target_resume_id: resumeId });
  });

  it("posts only to the Projects Worker, preserves exact hrefs, decodes server IDs, and accepts sparse ordered no-op results", async () => {
    const parentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const methodIds = ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"];
    const draft = [{ id: "local-1-1", position: 0, sourceKey: null,
      translations: { zh: { title: "项目", subtitle: "", period: "2025", description: "", href: "" },
        en: { title: "Project", subtitle: "", period: "2025", description: "", href: "https://example.test" } },
      methods: { zh: methodIds.map((id, position) => ({ id, position, value: `方法${position}` })), en: [] } }];
    const response = [{ id: parentId, position: 0, zh: draft[0]!.translations.zh, en: draft[0]!.translations.en,
      methods: { zh: methodIds.map((id, position) => ({ id, position: position === 2 ? 3 : position, value: `方法${position}` })), en: [] } }];
    const supabase = { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "session-token", expires_at: Date.now() / 1000 + 3600 } }, error: null })) } };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json(response);
    }));
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    await expect(repo.saveProjectsWithWorker!(resumeId, draft)).resolves.toMatchObject([{ id: parentId, position: 0,
      translations: { zh: { href: "" }, en: { href: "https://example.test" } },
      methods: { zh: [{ id: methodIds[0], position: 0 }, { id: methodIds[1], position: 1 }, { id: methodIds[2], position: 2 }] } }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/admin/v1/projects/save");
    expect(calls[0]!.body.projects).toEqual([{ id: null, position: 0, zh: draft[0]!.translations.zh, en: draft[0]!.translations.en,
      methods: { zh: methodIds.map((id, position) => ({ id, position, value: `方法${position}` })), en: [] } }]);
    expect(repo.hasPendingProjectsWorkerSave!(resumeId)).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("Experience and Skills repository signed write routing", () => {
  const resumeId = "ea111111-1111-4111-8111-111111111111";
  const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: "session-token", expires_at: Date.now() / 1000 + 3600 } }, error: null })) };
  it.each([
    ["experience", "load_admin_experience_write_state", "experience_write_mode", "experience_trusted_context_required"],
    ["skills", "load_admin_skills_write_state", "skills_write_mode", "skills_trusted_context_required"],
  ] as const)("loads target-scoped %s state and rejects mismatched target data", async (domain, rpcName, modeKey, requirementKey) => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resume_id: resumeId, activity_log_enabled: true, [modeKey]: "rpc", [requirementKey]: true }], error: null });
    const repo = repository(rpc);
    const load = domain === "experience" ? repo.loadAdminExperienceWriteState! : repo.loadAdminSkillsWriteState!;
    await expect(load(resumeId)).resolves.toMatchObject({ resumeId, domain, activityLogEnabled: true, writeMode: "rpc", trustedContextRequired: true });
    expect(rpc).toHaveBeenCalledWith(rpcName, { target_resume_id: resumeId });
    const invalid = vi.fn().mockResolvedValue({ data: [{ resume_id: "other-target", activity_log_enabled: true, [modeKey]: "rpc", [requirementKey]: true }], error: null });
    await expect((domain === "experience" ? repository(invalid).loadAdminExperienceWriteState! : repository(invalid).loadAdminSkillsWriteState!)(resumeId)).rejects.toThrow("Invalid");
  });

  it.each(["experience", "skills"] as const)("uses only the typed %s Worker endpoint and accepts canonical generated IDs", async domain => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const draft = domain === "experience"
      ? [{ id: "local-1-1", position: 0, sourceKey: null, translations: {
          zh: { organization: "机构", title: "职位", period: "2025", description: "描述", location: null },
          en: { organization: "Org", title: "Role", period: "2025", description: "Work", location: "" },
        } }]
      : [{ id: "local-1-1", position: 0, sourceKey: null, translations: { zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "English" } } }];
    const response = domain === "experience"
      ? [{ id, position: 0, en: { location: "", description: "Work", period: "2025", title: "Role", organization: "Org" },
          zh: { location: null, description: "描述", period: "2025", title: "职位", organization: "机构" } }]
      : [{ id, position: 0, en: { items: "English", title: "Languages" }, zh: { items: "中文", title: "语言" } }];
    const supabase = { rpc: vi.fn(), from: vi.fn(), auth };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json(response);
    }));
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    const save = domain === "experience" ? repo.saveExperienceWithWorker! : repo.saveSkillsWithWorker!;
    const result = await save(resumeId, draft as never[]);
    expect(result).toMatchObject([{ id, position: 0 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/admin/v1/${domain}/save`);
    expect(calls[0]!.body[domain]).toMatchObject([{ id: null, position: 0 }]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("Contact repository typed writer and V2 decoder", () => {
  const resumeId = "ea111111-1111-4111-8111-111111111111";
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const contact = { translations: { zh: { contactLabel: "联系", availability: "交流" }, en: { contactLabel: "Contact", availability: "Open" } },
    focus: [{ id: "local-focus", position: 0, translations: { zh: { title: "项目", detail: "实践" }, en: { title: "Projects", detail: "Practice" } } }],
    status: [{ id: "local-status", position: 0, statusType: "open" as const, translations: { zh: { title: "开放", detail: "交流" }, en: { title: "Open", detail: "Discuss" } } }] };
  const rpcRow = (overrides: Record<string, unknown> = {}) => ({ event_source: "activity", source_rank: 1,
    id: "contact-event", occurred_at: "2026-10-05T01:00:00Z", actor_email_snapshot: "qa@example.test", actor_role_snapshot: "qa",
    operation: "update", section_key: "contact", entity_type: "contact_section", entity_id: null,
    entity_snapshot: { contact: {} }, changes: { contact: { before: {}, after: {} } }, payload_version: 2,
    event_kind: null, outcome: null, failure_stage: null, failure_code: null, request_id: null,
    ip_network: null, country_code: null, region: null, city: null, ...overrides });

  it("loads Contact mode state and preserves one exact Worker request after an ambiguous response", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const response = { translations: { zh: { contact_label: "联系", availability: "交流" }, en: { contact_label: "Contact", availability: "Open" } },
      focus: [{ id, position: 0, zh: { title: "项目", detail: "实践" }, en: { title: "Projects", detail: "Practice" } }],
      status: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0, status_type: "open", zh: { title: "开放", detail: "交流" }, en: { title: "Open", detail: "Discuss" } }] };
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: [{ resume_id: resumeId, activity_log_enabled: true,
      contact_write_mode: "rpc", contact_trusted_context_required: true }], error: null }), from: vi.fn(),
      auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "session-token", expires_at: Date.now() / 1000 + 3600 } }, error: null })) } };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let failOnce = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (failOnce) { failOnce = false; throw new Error("lost response"); }
      return Response.json(response);
    }));
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    await expect(repo.loadAdminContactWriteState!(resumeId)).resolves.toMatchObject({ resumeId, contactWriteMode: "rpc", contactTrustedContextRequired: true });
    await expect(repo.saveContactWithWorker!(resumeId, contact)).rejects.toThrow("exact pending request");
    await expect(repo.saveContactWithWorker!(resumeId, contact)).resolves.toMatchObject({
      focus: [{ id, position: 0 }], status: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0, statusType: "open" }],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("/api/admin/v1/contact/save");
    expect(calls[0]!.body.request_id).toBe(calls[1]!.body.request_id);
    expect(calls[0]!.body.contact).toEqual(calls[1]!.body.contact);
    expect(calls[0]!.body.contact).toMatchObject({ focus: [{ id: null, position: 0 }], status: [{ id: null, position: 0, status_type: "open" }] });
    expect(repo.hasPendingContactWorkerSave!(resumeId)).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("accepts valid Contact V2 with sparse before order and rejects malformed status semantics", async () => {
    const before = { translations: { zh: { contact_label: "联系", availability: "交流" }, en: { contact_label: "Contact", availability: "Open" } },
      focus: [{ id, position: 3, zh: { title: "项目", detail: "实践" }, en: { title: "Projects", detail: "Practice" } }],
      status: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 2, status_type: "open", zh: { title: "开放", detail: "交流" }, en: { title: "Open", detail: "Discuss" } }] };
    const after = { ...before, focus: [{ ...before.focus[0]!, position: 0, zh: { ...before.focus[0]!.zh, detail: "更新" } }],
      status: [{ ...before.status[0]!, position: 0 }] };
    const valid = vi.fn().mockResolvedValue({ data: [rpcRow({ entity_snapshot: { contact: after }, changes: { contact: { before, after } } })], error: null });
    await expect(repository(valid).loadActivityLogPageV13C!(resumeId, 25, { eventFilter: "all", section: "", operation: "", actorEmail: "", dateFrom: null, dateToExclusive: null, search: "" }))
      .resolves.toMatchObject([{ section: "contact", entityType: "contact_section", payloadVersion: 2 }]);
    const malformedAfter = { ...after, status: [{ ...after.status[0]!, status_type: "unknown" }] };
    const malformed = vi.fn().mockResolvedValue({ data: [rpcRow({ entity_snapshot: { contact: malformedAfter },
      changes: { contact: { before, after: malformedAfter } } })], error: null });
    await expect(repository(malformed).loadActivityLogPageV13C!(resumeId, 25, { eventFilter: "all", section: "", operation: "", actorEmail: "", dateFrom: null, dateToExclusive: null, search: "" }))
      .rejects.toThrow("Invalid Activity Log response");
  });
});
