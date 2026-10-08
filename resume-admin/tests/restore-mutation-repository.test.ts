import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository } from "../src/data/resumeRepository";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const sourceEventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request = { resumeId, sourceEventId, expectedCurrentDigest: "a".repeat(64), requestId };
const restored = { status: "restored", domain: "awards", source_event_id: sourceEventId,
  result_event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", occurred_at: "2026-10-08T02:10:04Z" };
const pendingKey = `admin-restore-v1-pending:${resumeId}:${sourceEventId}`;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.sessionStorage.removeItem(pendingKey); });

function repository(getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "qa-user-token" } }, error: null })) {
  const rpc = vi.fn(); const from = vi.fn();
  return { repo: createResumeRepository({ auth: { getSession }, rpc, from } as unknown as SupabaseClient), rpc, from };
}

describe("generic Restore mutation repository boundary", () => {
  it("sends only the exact four-field body with the authenticated session to the dedicated endpoint", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return Response.json(restored); }); vi.stubGlobal("fetch", fetchMock);
    const { repo, rpc, from } = repository();
    await expect(repo.restoreDomain!(request, "new")).resolves.toEqual({
      status: "restored", domain: "awards", source_event_id: sourceEventId,
      result_event_id: restored.result_event_id, occurred_at: restored.occurred_at,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/v1/restore/apply");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer qa-user-token");
    expect(JSON.parse(String(init?.body))).toEqual({ resume_id: resumeId, source_event_id: sourceEventId,
      expected_current_digest: request.expectedCurrentDigest, request_id: requestId });
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(pendingKey)).toBeNull();
  });

  it("retains and explicitly retries the identical pending body after transport ambiguity", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network disconnected")).mockResolvedValueOnce(Response.json(restored));
    vi.stubGlobal("fetch", fetchMock);
    const { repo, rpc, from } = repository();
    await expect(repo.restoreDomain!(request, "new")).rejects.toMatchObject({ code: "outcome_unknown", uncertain: true });
    expect(repo.getPendingRestoreAttempt!(resumeId, sourceEventId)).toEqual(request);
    await expect(repo.restoreDomain!(request, "retry")).resolves.toMatchObject({ status: "restored" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)));
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });

  it("does not dispatch a second new logical attempt when a pending request exists", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network")); vi.stubGlobal("fetch", fetchMock);
    const { repo } = repository();
    await expect(repo.restoreDomain!(request, "new")).rejects.toMatchObject({ uncertain: true });
    await expect(repo.restoreDomain!({ ...request, requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, "new"))
      .rejects.toMatchObject({ code: "pending_conflict", uncertain: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("clears a definitive stale rejection and preserves an ambiguous server failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: "stale_preview", message: "private" } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "restore_unavailable" } }, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const { repo } = repository();
    await expect(repo.restoreDomain!(request, "new")).rejects.toMatchObject({ code: "stale_preview", uncertain: false });
    expect(window.sessionStorage.getItem(pendingKey)).toBeNull();
    await expect(repo.restoreDomain!(request, "new")).rejects.toMatchObject({ code: "outcome_unknown", uncertain: true });
    expect(repo.getPendingRestoreAttempt!(resumeId, sourceEventId)).toEqual(request);
  });

  it("fails closed before dispatch when session storage cannot retain the request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { repo, rpc, from } = repository();
    await expect(repo.restoreDomain!(request, "new")).rejects.toMatchObject({ code: "storage_unavailable", uncertain: false });
    expect(fetchMock).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("rejects malformed result data and never exposes private response text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...restored, entity_snapshot: { secret: "hidden" } })));
    const { repo } = repository();
    await expect(repo.restoreDomain!(request, "new")).rejects.toMatchObject({ code: "outcome_unknown", uncertain: true });
    expect(window.sessionStorage.getItem(pendingKey)).not.toBeNull();
  });
});
