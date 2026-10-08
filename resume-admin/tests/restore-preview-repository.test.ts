import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository, RestorePreviewError } from "../src/data/resumeRepository";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const historical = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0,
  zh: { name: "奖项", year: "2024" }, en: { name: "Award", year: "2024" } }];
const responseValue = {
  status: "ready", source_event_id: eventId, source_occurred_at: "2026-10-05T02:10:04+00:00", domain: "awards",
  historical_state: historical, current_state: [],
  comparison: { before: [], after: historical }, expected_current_digest: "a".repeat(64),
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function repository(getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "qa-user-token" } }, error: null })) {
  return createResumeRepository({ auth: { getSession }, rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient);
}

describe("generic Restore preview repository boundary", () => {
  it("sends only target and source identifiers to the authenticated Worker route and maps the typed preview", async () => {
    const calls: Array<Parameters<typeof fetch>> = [];
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      calls.push(args);
      return Response.json(responseValue);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await repository().previewRestore!({ resumeId, sourceEventId: eventId });
    expect(result).toEqual({
      status: "ready", sourceEventId: eventId, sourceOccurredAt: responseValue.source_occurred_at, domain: "awards",
      historicalState: historical, currentState: [],
      comparison: { before: [], after: historical }, expectedCurrentDigest: responseValue.expected_current_digest,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = calls[0]!;
    expect(url).toBe("/api/admin/v1/restore/preview");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer qa-user-token");
    expect(JSON.parse(String(init?.body))).toEqual({ resume_id: resumeId, source_event_id: eventId });
    expect(JSON.stringify(init?.body)).not.toMatch(/domain|historical_state|expected_current_digest|entity_snapshot/i);
  });

  it("maps sanitized backend error codes without exposing upstream messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "source_ineligible", message: "private backend detail" } }, { status: 422 })));
    const error = await repository().previewRestore!({ resumeId, sourceEventId: eventId }).catch(value => value);
    expect(error).toBeInstanceOf(RestorePreviewError);
    expect(error).toMatchObject({ code: "source_ineligible" });
    expect(error.message).not.toContain("private backend detail");
  });

  it("maps unknown Worker errors to a generic preview failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "future_private_error", message: "secret" } }, { status: 500 })));
    const error = await repository().previewRestore!({ resumeId, sourceEventId: eventId }).catch(value => value);
    expect(error).toMatchObject({ code: "preview_unavailable" });
    expect(error.message).not.toContain("secret");
  });

  it.each([
    ["extra audit metadata", { ...responseValue, actor_user_id: "10000000-0000-4000-8000-000000000002" }],
    ["wrong source identity", { ...responseValue, source_event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["unsupported domain", { ...responseValue, domain: "files" }],
    ["malformed digest", { ...responseValue, expected_current_digest: "not-a-digest" }],
    ["nested audit metadata", { ...responseValue, historical_state: [{ ...historical[0], zh: { ...historical[0]!.zh, actor_user_id: "10000000-0000-4000-8000-000000000002" } }] }],
    ["parseable non-contract timestamp", { ...responseValue, source_occurred_at: "October 5, 2026" }],
    ["contradictory status", { ...responseValue, status: "no_change" }],
  ])("fails closed for %s", async (_label, value) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(value)));
    await expect(repository().previewRestore!({ resumeId, sourceEventId: eventId }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not call the Worker or database for malformed identifiers or missing session", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const repo = repository();
    await expect(repo.previewRestore!({ resumeId, sourceEventId: "malformed" })).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetchMock).not.toHaveBeenCalled();
    const missingSession = repository(vi.fn().mockResolvedValue({ data: { session: null }, error: null }));
    await expect(missingSession.previewRestore!({ resumeId, sourceEventId: eventId })).rejects.toMatchObject({ code: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
