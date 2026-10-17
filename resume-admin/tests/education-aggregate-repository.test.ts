import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository } from "../src/data/resumeRepository";
import type { EducationItem } from "../src/model";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const generatedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const savedLocale = { title: "Summer", program: "P", period: "2025", grade: "A", course_title: null, course_description: "", custom_category_label: null };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); try { sessionStorage.clear(); } catch { /* non-browser test */ } });

function education(): EducationItem {
  return { id: generatedId, position: 0, sourceKey: "kept-source", entryType: "summerSchool", category: "summerSchool", persistedCategory: null,
    translations: { zh: { title: "暑期学校", program: "项目", period: "2025", grade: "A", courseTitle: null, courseDescription: "", customCategoryLabel: null },
      en: { title: "Summer", program: "P", period: "2025", grade: "A", courseTitle: null, courseDescription: "", customCategoryLabel: null } } };
}

describe("Education aggregate repository contract", () => {
  it("loads target-scoped write state and fails closed on malformed state", async () => {
    const rpc = vi.fn(async () => ({ data: [{ resume_id: resumeId, activity_log_enabled: true,
      education_write_mode: "rpc", education_trusted_context_required: true }], error: null }));
    const repo = createResumeRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.loadAdminEducationWriteState!(resumeId)).resolves.toEqual({ resumeId,
      activityLogEnabled: true, educationWriteMode: "rpc", educationTrustedContextRequired: true });
    expect(rpc).toHaveBeenCalledWith("load_admin_education_write_state", { target_resume_id: resumeId });
    rpc.mockImplementationOnce(async () => ({ data: [{ resume_id: resumeId, activity_log_enabled: true,
      education_write_mode: "direct", education_trusted_context_required: true }], error: null }));
    await expect(repo.loadAdminEducationWriteState!(resumeId)).rejects.toThrow("Invalid Education write state");
  });

  it("sends a raw-NULL category and exact bilingual NULL/empty values through the Worker, preserving server fields", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestId });
    const rpc = vi.fn();
    const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-user-token", expires_at: Date.now() / 1000 + 3600 } }, error: null })) };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ request_id: requestId, resume_id: resumeId });
      const payload = body.education as Array<Record<string, unknown>>;
      expect(payload[0]).toMatchObject({ id: generatedId, position: 0, entry_type: "summerSchool", education_category: null });
      expect(payload[0].zh).toMatchObject({ course_title: null, course_description: "" });
      expect(payload[0].en).toMatchObject({ course_title: null, course_description: "" });
      return Response.json([{ id: generatedId, position: 0, entry_type: "summerSchool", education_category: null,
        zh: { ...savedLocale, title: "暑期学校", program: "项目" }, en: savedLocale }]);
    });
    vi.stubGlobal("fetch", fetch);
    const repo = createResumeRepository({ rpc, auth } as unknown as SupabaseClient);
    const [result] = await repo.saveEducationWithWorker!(resumeId, [education()]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: generatedId, sourceKey: "kept-source", category: "summerSchool", persistedCategory: null,
      translations: { en: { courseTitle: null, courseDescription: "" } } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("replays a committed Education request after a lost response without duplicating its event", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestId });
    const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-user-token", expires_at: Date.now() / 1000 + 3600 } }, error: null })) };
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
        committed = (body.education as Array<Record<string, unknown>>).map(entry => ({ ...entry, id: entry.id ?? generatedId }));
        eventCount++;
      }
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("response lost after commit");
      }
      return Response.json(committed);
    }));

    const repoAfterSave = createResumeRepository({ rpc: vi.fn(), auth } as unknown as SupabaseClient);
    const newEntry: EducationItem = { ...education(), id: "local-education-new-entry", sourceKey: null,
      translations: { ...education().translations, zh: { ...education().translations.zh, title: "新建后提交" } } };
    await expect(repoAfterSave.saveEducationWithWorker!(resumeId, [newEntry])).rejects.toThrow("save result is uncertain");
    expect(repoAfterSave.hasPendingEducationWorkerSave!(resumeId)).toBe(true);
    expect(eventCount).toBe(1);

    // A fresh repository instance models a page refresh; sessionStorage retains the request.
    const repoAfterRefresh = createResumeRepository({ rpc: vi.fn(), auth } as unknown as SupabaseClient);
    const refreshedEntry = { ...newEntry, id: generatedId };
    await expect(repoAfterRefresh.saveEducationWithWorker!(resumeId, [refreshedEntry])).resolves.toMatchObject([{ id: generatedId }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.request_id).toBe(calls[1]?.request_id);
    expect(calls[0]?.education).toEqual(calls[1]?.education);
    expect((calls[0]?.education as Array<Record<string, unknown>>)[0]?.id).toBeNull();
    expect(eventCount).toBe(1);
    expect(repoAfterRefresh.hasPendingEducationWorkerSave!(resumeId)).toBe(false);
  });
});
