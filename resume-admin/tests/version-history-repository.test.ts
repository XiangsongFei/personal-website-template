import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository, type VersionHistoryCursor } from "../src/data/resumeRepository";

function repository(rpc: ReturnType<typeof vi.fn>) {
  return createResumeRepository({ rpc, from: vi.fn() } as unknown as SupabaseClient);
}

const id1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const id2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const row = (overrides: Record<string, unknown> = {}) => ({
  event_id: id1,
  occurred_at: "2026-10-11T10:00:00Z",
  actor_account_label: "qa@example.test",
  actor_role: "qa",
  domain_key: "awards",
  operation: "update",
  payload_version: 1,
  entity_type: "award_entry",
  entity_id: "award-1",
  comparison_kind: "entity_fields",
  comparison: { changes: { name: { before: "Old", after: "New" } } },
  has_more: false,
  ...overrides,
});

afterEach(() => { vi.restoreAllMocks(); });

describe("Version History repository typed read contract", () => {
  it("maps a V1 field entry and a V2 aggregate without exposing audit metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      row(),
      row({ event_id: id2, payload_version: 2, entity_type: "award_list", entity_id: null,
        comparison_kind: "aggregate", comparison: { before: { awards: [] }, after: { awards: [{ id: "stable", position: 0 }] } } }),
    ], error: null });
    const page = await repository(rpc).loadVersionHistoryPage!("qa-resume", 25);
    expect(page).toEqual({
      entries: [
        { eventId: id1, occurredAt: "2026-10-11T10:00:00Z", actorAccountLabel: "qa@example.test", actorRole: "qa", domain: "awards", operation: "update", payloadVersion: 1, entityType: "award_entry", entityId: "award-1", comparison: { kind: "entity_fields", changes: { name: { before: "Old", after: "New" } } } },
        { eventId: id2, occurredAt: "2026-10-11T10:00:00Z", actorAccountLabel: "qa@example.test", actorRole: "qa", domain: "awards", operation: "update", payloadVersion: 2, entityType: "award_list", entityId: null, comparison: { kind: "aggregate", before: { awards: [] }, after: { awards: [{ id: "stable", position: 0 }] } } },
      ], hasMore: false, nextCursor: null,
    });
    expect(JSON.stringify(page)).not.toMatch(/actor_user_id|ip_network|country_code|request_id|idempotency/i);
  });

  it("maps unknown versions to a generic entry with no comparison payload", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row({ payload_version: 99, comparison_kind: "unavailable", comparison: null })], error: null });
    await expect(repository(rpc).loadVersionHistoryPage!("qa-resume", 25)).resolves.toMatchObject({
      entries: [{ payloadVersion: 99, comparison: { kind: "unavailable" } }], hasMore: false, nextCursor: null,
    });
  });

  it("fails closed for malformed known-version comparisons and unexpected row fields", async () => {
    const malformed = vi.fn().mockResolvedValue({ data: [row({ comparison: { changes: { name: { before: "missing after" } } } })], error: null });
    await expect(repository(malformed).loadVersionHistoryPage!("qa-resume", 25)).rejects.toThrow("Invalid Version History response");
    const leaked = vi.fn().mockResolvedValue({ data: [row({ ip_network: "203.0.113.0/24" })], error: null });
    await expect(repository(leaked).loadVersionHistoryPage!("qa-resume", 25)).rejects.toThrow("Invalid Version History response");
  });

  it("accepts only reference fields for V1 Files and profile-photo entries", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      row({ domain_key: "files", payload_version: 1, entity_type: "resume_file", entity_id: null,
        comparison: { changes: { locale: { before: "zh", after: "zh" }, object_key: { before: "old", after: "new" } } } }),
      row({ event_id: id2, domain_key: "profile", payload_version: 1, entity_type: "profile_image", entity_id: null,
        comparison: { changes: { object_key: { before: null, after: "managed/profile.png" } } } }),
    ], error: null });
    await expect(repository(rpc).loadVersionHistoryPage!("qa-resume", 25)).resolves.toMatchObject({
      entries: [
        { domain: "files", comparison: { kind: "entity_fields", changes: { locale: { before: "zh", after: "zh" }, object_key: { before: "old", after: "new" } } } },
        { domain: "profile", comparison: { kind: "entity_fields", changes: { object_key: { before: null, after: "managed/profile.png" } } } },
      ],
    });
    const privateMetadata = vi.fn().mockResolvedValue({ data: [row({ domain_key: "files", entity_type: "resume_file", payload_version: 1,
      comparison: { changes: { file_name: { before: "private.pdf", after: "new.pdf" } } } })], error: null });
    await expect(repository(privateMetadata).loadVersionHistoryPage!("qa-resume", 25)).rejects.toThrow("Invalid Version History response");
  });

  it("uses bounded keyset RPC arguments and returns the last-row cursor only when more exists", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row({ has_more: true })], error: null });
    const cursor: VersionHistoryCursor = { occurredAt: "2026-10-10T10:00:00Z", eventId: id2 };
    await expect(repository(rpc).loadVersionHistoryPage!("qa-resume", 40, cursor)).resolves.toMatchObject({
      hasMore: true, nextCursor: { occurredAt: "2026-10-11T10:00:00Z", eventId: id1 },
    });
    expect(rpc).toHaveBeenCalledWith("read_version_history_v1", {
      target_resume_id: "qa-resume", page_limit: 40, before_occurred_at: cursor.occurredAt, before_event_id: cursor.eventId,
    });
  });

  it("rejects malformed page requests and cursors before RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repo = repository(rpc);
    await expect(repo.loadVersionHistoryPage!("qa-resume", 0)).rejects.toThrow("Invalid Version History page request");
    await expect(repo.loadVersionHistoryPage!("qa-resume", 25, { occurredAt: "bad", eventId: id1 })).rejects.toThrow("Invalid Version History cursor");
    expect(rpc).not.toHaveBeenCalled();
  });
});
