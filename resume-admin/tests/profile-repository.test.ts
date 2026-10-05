import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixtureSections } from "../src/fixtures";
import { profileAggregateFromSection } from "../src/data/profileAggregate";
import { createResumeRepository } from "../src/data/resumeRepository";

const resumeId = "ea111111-1111-4111-8111-111111111111";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.sessionStorage.clear(); });

describe("Profile transactional repository", () => {
  it("decodes target-scoped write state and rejects an invalid direct/trusted combination", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resume_id: resumeId, activity_log_enabled: true, profile_write_mode: "rpc", profile_trusted_context_required: true }], error: null });
    const repo = createResumeRepository({ rpc, from: vi.fn() } as unknown as SupabaseClient);
    await expect(repo.loadAdminProfileWriteState!(resumeId)).resolves.toEqual({ resumeId, activityLogEnabled: true, profileWriteMode: "rpc", profileTrustedContextRequired: true });
  });

  it("uses one Worker request and replays the exact pending request after an ambiguous response", async () => {
    const profile = profileAggregateFromSection(fixtureSections.profile);
    const getSession = vi.fn(async () => ({ data: { session: { access_token: "session-token", expires_at: Date.now() / 1000 + 3600 } }, error: null }));
    const supabase = { rpc: vi.fn(), from: vi.fn(), auth: { getSession } };
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(input), body });
      if (fail) { fail = false; throw new TypeError("network disconnected"); }
      return Response.json(profile);
    }));
    await expect(repo.saveProfileWithWorker!(resumeId, fixtureSections.profile, profile.shared.photo_url)).rejects.toThrow("uncertain");
    expect(repo.hasPendingProfileWorkerSave!(resumeId)).toBe(true);
    await expect(repo.saveProfileWithWorker!(resumeId, fixtureSections.profile, profile.shared.photo_url)).resolves.toEqual(fixtureSections.profile);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("/api/admin/v1/profile/save");
    expect(calls[1]!.body).toEqual(calls[0]!.body);
    expect(repo.hasPendingProfileWorkerSave!(resumeId)).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects a mismatched authoritative Worker result and retains the request for safe replay", async () => {
    const profile = profileAggregateFromSection(fixtureSections.profile);
    const supabase = { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "x", expires_at: Date.now() / 1000 + 3600 } }, error: null })) } };
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...profile, shared: { ...profile.shared, footer_name: "unexpected" } })));
    await expect(repo.saveProfileWithWorker!(resumeId, fixtureSections.profile, profile.shared.photo_url)).rejects.toThrow("did not match");
    expect(repo.hasPendingProfileWorkerSave!(resumeId)).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
