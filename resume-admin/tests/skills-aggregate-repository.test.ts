import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AggregateWorkerSaveError, createResumeRepository } from "../src/data/resumeRepository";
import type { SkillItem } from "../src/model";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const groupAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const groupBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actorId = "10000000-0000-4000-8000-000000000002";
const pendingKey = `admin-pending-save-v2:skills:${resumeId}:${actorId}`;
const baselineDigest = "1".repeat(64);
const baselineProof = "2".repeat(64);

function skill(id: string, titleZh = "语言", itemsZh = "中文", titleEn = "Languages", itemsEn = "Chinese"): SkillItem {
  return { id, position: 0, sourceKey: null,
    translations: { zh: { title: titleZh, items: itemsZh }, en: { title: titleEn, items: itemsEn } } };
}

function repository(snapshot: Array<Record<string, unknown>> = []) {
  const supabase = { rpc: vi.fn(async (name: string) => name === "load_admin_skills_write_state" ? ({ data: [{
    resume_id: resumeId, activity_log_enabled: true, skills_write_mode: "rpc", skills_trusted_context_required: true,
    skills_snapshot: snapshot, skills_baseline_digest: baselineDigest, skills_baseline_proof: baselineProof,
  }], error: null }) : ({ data: null, error: null })), from: vi.fn(), auth: {
    getSession: vi.fn(async () => ({ data: { session: { access_token: "session-token", expires_at: Date.now() / 1000 + 3600, user: { id: actorId } } }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: actorId } }, error: null })),
  } };
  return createResumeRepository(supabase as unknown as SupabaseClient);
}

function responseFor(payload: Array<Record<string, unknown>>) {
  return payload.map((entry, position) => {
    const id = entry.id === null ? position === 0 ? groupAId : groupBId : entry.id as string;
    return { id, position, zh: entry.zh, en: entry.en };
  });
}

function requestFrom(init: RequestInit) {
  return JSON.parse(String(init.body)) as { request_id: string; resume_id: string; skills: Array<Record<string, unknown>>; expected_baseline_digest: string; baseline_proof: string };
}

afterEach(() => {
  window.sessionStorage.removeItem(pendingKey);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Skills aggregate RPC repository", () => {
  it("saves Skills through the RPC route and maps a temporary local ID to a canonical UUID", async () => {
    const draft = [skill("local-1-1")];
    const calls: Array<{ url: string; body: ReturnType<typeof requestFrom> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: requestFrom(init) });
      return Response.json([{ id: groupAId, position: 0,
        zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "Chinese" } }]);
    }));

    const repo = repository();
    await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, draft)).resolves.toMatchObject([{ id: groupAId, position: 0,
      translations: { zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "Chinese" } } }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/admin/v1/skills/save");
    expect(calls[0]!.body.skills).toEqual([{ id: null, position: 0,
      zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "Chinese" } }]);
    expect(window.sessionStorage.getItem(pendingKey)).toBeNull();
  });

  it("replays the original pending request after a lost committed response without duplicating a group or event", async () => {
    const firstDraft = [skill("local-1-1")];
    const committedByRequest = new Map<string, ReturnType<typeof responseFor>>();
    const calls: Array<ReturnType<typeof requestFrom>> = [];
    let groupCount = 0;
    let activityEventCount = 0;
    let loseFirstResponse = true;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const request = requestFrom(init);
      calls.push(request);
      let committed = committedByRequest.get(request.request_id);
      if (!committed) {
        committed = responseFor(request.skills);
        committedByRequest.set(request.request_id, committed);
        groupCount += committed.length;
        activityEventCount += 1;
      }
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("response lost after commit");
      }
      return Response.json(committed);
    }));

    const initialRepo = repository();
    await initialRepo.loadSkills!(resumeId);
    await expect(initialRepo.saveSkillsWithWorker!(resumeId, firstDraft)).rejects.toBeInstanceOf(AggregateWorkerSaveError);
    const stored = JSON.parse(window.sessionStorage.getItem(pendingKey) ?? "null") as {
      requestId: string; resumeId: string; payload: unknown[]; requestMetadata: { expectedBaselineDigest: string; baselineProof: string };
    };
    expect(stored).toMatchObject({ resumeId, payload: [{ id: null, position: 0,
      zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "Chinese" } }] });
    expect(stored.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(stored.requestMetadata).toEqual({ expectedBaselineDigest: baselineDigest, baselineProof });

    // A fresh repository represents a page refresh; the loaded row now has its server UUID.
    const refreshedDraft = [skill(groupAId)];
    const refreshedRepo = repository(responseFor(calls[0]!.skills));
    await refreshedRepo.loadSkills!(resumeId);
    await expect(refreshedRepo.saveSkillsWithWorker!(resumeId, refreshedDraft)).resolves.toMatchObject([{ id: groupAId }]);

    expect(calls).toHaveLength(2);
    expect(calls[1]!.request_id).toBe(calls[0]!.request_id);
    expect(calls[1]!.skills).toEqual(calls[0]!.skills);
    expect(calls[1]!.skills[0]!.id).toBeNull();
    expect(groupCount).toBe(1);
    expect(activityEventCount).toBe(1);
    expect(window.sessionStorage.getItem(pendingKey)).toBeNull();
  });

  it("allows an exact same-page retry with unchanged null IDs", async () => {
    const draft = [skill("local-1-1")];
    const calls: Array<ReturnType<typeof requestFrom>> = [];
    let loseFirstResponse = true;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const request = requestFrom(init);
      calls.push(request);
      if (loseFirstResponse) { loseFirstResponse = false; throw new Error("response lost"); }
      return Response.json(responseFor(request.skills));
    }));

    const repo = repository();
    await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, draft)).rejects.toBeInstanceOf(AggregateWorkerSaveError);
    await expect(repo.saveSkillsWithWorker!(resumeId, draft)).resolves.toMatchObject([{ id: groupAId }]);
    expect(calls[1]!.request_id).toBe(calls[0]!.request_id);
    expect(calls[1]!.skills).toEqual(calls[0]!.skills);
    expect(calls[1]!.skills[0]!.id).toBeNull();
  });

  it.each([
    ["Chinese content", (rows: SkillItem[]) => { rows[0]!.translations.zh.items = "已修改"; }],
    ["English content", (rows: SkillItem[]) => { rows[0]!.translations.en.items = "Changed"; }],
    ["order", (rows: SkillItem[]) => { rows.reverse(); rows.forEach((row, position) => { row.position = position; }); }],
    ["UUID", (rows: SkillItem[]) => { rows[1]!.id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; }],
    ["duplicate UUIDs", (rows: SkillItem[]) => { rows[1]!.id = rows[0]!.id; }],
  ] as const)("fails closed and retains pending state when refreshed %s differs", async (_case, mutate) => {
    const originalDraft = [skill("local-1-1"), skill(groupBId, "工具", "测试", "Tools", "Testing")];
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("response lost after commit"); }));
    const repo = repository([{ id: groupBId, position: 0, zh: { title: "工具", items: "测试" }, en: { title: "Tools", items: "Testing" } }]);
    await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, originalDraft)).rejects.toBeInstanceOf(AggregateWorkerSaveError);
    const pendingBefore = window.sessionStorage.getItem(pendingKey);
    expect(pendingBefore).not.toBeNull();

    const refreshedDraft = [skill(groupAId), skill(groupBId, "工具", "测试", "Tools", "Testing")];
    const draftBeforeRetry = structuredClone(refreshedDraft);
    mutate(refreshedDraft);
    const changedDraft = structuredClone(refreshedDraft);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(repository().saveSkillsWithWorker!(resumeId, refreshedDraft)).rejects.toBeInstanceOf(AggregateWorkerSaveError);
    expect(fetch).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(pendingKey)).toBe(pendingBefore);
    expect(refreshedDraft).toEqual(changedDraft);
    expect(refreshedDraft).not.toEqual(draftBeforeRetry);
  });

  it("retains pending state unless the server response is confirmed against the original request", async () => {
    const draft = [skill("local-1-1")];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ id: groupAId, position: 0,
      zh: { title: "unexpected", items: "中文" }, en: { title: "Languages", items: "Chinese" } }])));

    const repo = repository();
    await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, draft)).rejects.toThrow("could not be confirmed");
    expect(window.sessionStorage.getItem(pendingKey)).not.toBeNull();
  });
});
