import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository } from "../src/data/resumeRepository";
import type { ExperienceItem } from "../src/model";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const generatedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); try { sessionStorage.clear(); } catch { /* non-browser test */ } });

describe("Experience aggregate retry contract", () => {
  it("replays a committed create payload after refresh without duplicating its event", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestId, subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-user-token", expires_at: Date.now() / 1000 + 3600, user: { id: "10000000-0000-4000-8000-000000000002" } } }, error: null })), getUser: vi.fn(async () => ({ data: { user: { id: "10000000-0000-4000-8000-000000000002" } }, error: null })) };
    const seenRequests = new Set<string>();
    let committed: Array<Record<string, unknown>> = [];
    let eventCount = 0;
    const calls: Array<Record<string, unknown>> = [];
    let loseFirstResponse = true;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      const request = body.request_id as string;
      if (!seenRequests.has(request)) {
        seenRequests.add(request);
        committed = (body.experience as Array<Record<string, unknown>>).map(entry => ({ ...entry, id: entry.id ?? generatedId }));
        eventCount++;
      }
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("response lost after commit");
      }
      return Response.json(committed);
    }));

    const makeRepo = () => createResumeRepository({ rpc: vi.fn(), auth } as unknown as SupabaseClient);
    const entry: ExperienceItem = { id: "local-experience-new-entry", position: 0, sourceKey: null,
      translations: { zh: { organization: "机构", title: "新职位", period: "2025", description: "描述", location: null },
        en: { organization: "Org", title: "New role", period: "2025", description: "Description", location: null } } };
    await expect(makeRepo().saveExperienceWithWorker!(resumeId, [entry])).rejects.toThrow("save result is uncertain");
    expect(eventCount).toBe(1);
    const refreshed = { ...entry, id: generatedId, sourceKey: "persisted-source" };
    await expect(makeRepo().saveExperienceWithWorker!(resumeId, [{ ...refreshed,
      translations: { ...refreshed.translations, en: { ...refreshed.translations.en, title: "Later concurrent edit" } } }]))
      .rejects.toThrow("pending experience request does not match the current authenticated target and draft");
    expect(calls).toHaveLength(1);
    await expect(makeRepo().saveExperienceWithWorker!(resumeId, [refreshed]))
      .resolves.toMatchObject([{ id: generatedId, sourceKey: "persisted-source" }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.request_id).toBe(calls[1]?.request_id);
    expect(calls[0]?.experience).toEqual(calls[1]?.experience);
    expect((calls[0]?.experience as Array<Record<string, unknown>>)[0]?.id).toBeNull();
    expect(eventCount).toBe(1);
  });

  it("retries the exact pending Experience payload while a new entry ID is still null", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestId, subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-user-token", expires_at: Date.now() / 1000 + 3600, user: { id: "10000000-0000-4000-8000-000000000002" } } }, error: null })), getUser: vi.fn(async () => ({ data: { user: { id: "10000000-0000-4000-8000-000000000002" } }, error: null })) };
    let eventCount = 0;
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (calls.length === 1) {
        eventCount++;
        throw new Error("response lost after commit");
      }
      return Response.json((body.experience as Array<Record<string, unknown>>).map(entry => ({ ...entry, id: generatedId })));
    }));

    const entry: ExperienceItem = { id: "local-experience-new-entry", position: 0, sourceKey: null,
      translations: { zh: { organization: "机构", title: "新职位", period: "2025", description: "描述", location: null },
        en: { organization: "Org", title: "New role", period: "2025", description: "Description", location: null } } };
    const repo = createResumeRepository({ rpc: vi.fn(), auth } as unknown as SupabaseClient);
    await expect(repo.saveExperienceWithWorker!(resumeId, [entry])).rejects.toThrow("save result is uncertain");
    await expect(repo.saveExperienceWithWorker!(resumeId, [entry])).resolves.toMatchObject([{ id: generatedId }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.request_id).toBe(calls[1]?.request_id);
    expect(calls[0]?.experience).toEqual(calls[1]?.experience);
    expect((calls[1]?.experience as Array<Record<string, unknown>>)[0]?.id).toBeNull();
    expect(eventCount).toBe(1);
    expect(repo.hasPendingExperienceWorkerSave!(resumeId, actorId)).toBe(false);
  });
});
