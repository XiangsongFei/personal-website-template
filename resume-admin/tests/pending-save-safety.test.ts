import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository } from "../src/data/resumeRepository";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const secondResumeId = "eb111111-1111-4111-8111-111111111111";
const actorA = "10000000-0000-4000-8000-000000000002";
const actorB = "10000000-0000-4000-8000-000000000003";
const baseline = "1".repeat(64);
const awardDraft = [{ id: "local-1-1", position: 0, sourceKey: null,
  translations: { zh: { name: "奖项", year: "2025" }, en: { name: "Award", year: "2025" } } }];
const skillDraft = [{ id: "local-1-1", position: 0, sourceKey: null,
  translations: { zh: { title: "技能", items: "内容" }, en: { title: "Skill", items: "Details" } } }];

afterEach(() => { try { globalThis.sessionStorage?.clear(); } catch { /* A hostile storage test may replace the API. */ } vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function client(actor: () => string = () => actorA, targetId = resumeId) {
  return { rpc: vi.fn(async (name: string) => ({ data: [{ resume_id: targetId, activity_log_enabled: true,
    ...(name === "load_admin_skills_write_state" ? { skills_write_mode: "rpc", skills_trusted_context_required: true,
      skills_snapshot: [], skills_baseline_digest: baseline, skills_baseline_proof: "2".repeat(64) }
      : { awards_write_mode: "rpc", awards_trusted_context_required: true, awards_snapshot: [], awards_baseline_digest: baseline, awards_baseline_proof: "2".repeat(64) }) }], error: null })),
    from: vi.fn(), auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: `token-${actor()}`, expires_at: Date.now() / 1000 + 3600, user: { id: actor() } } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: actor() } }, error: null })),
    } };
}
function canonicalAwardResponse(id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  return { awards: [{ id, position: 0, zh: { name: "奖项", year: "2025" }, en: { name: "Award", year: "2025" } }], baseline_digest: baseline, baseline_proof: "2".repeat(64) };
}

describe("identity-bound pending save envelope", () => {
  it("allows the same authenticated actor to resume an uncertain Awards request, while actor B gets a different request and no A envelope", async () => {
    let signedInActor = actorA;
    const supabase = client(() => signedInActor);
    const requests: Array<{ body: Record<string, unknown>; authorization: string }> = [];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, authorization: String(new Headers(init.headers).get("Authorization")) });
      call += 1;
      if (call < 2) throw new Error("lost response");
      return Response.json(canonicalAwardResponse());
    }));
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("uncertain");
    const aRequestId = requests[0]!.body.request_id;
    const aStorageKey = `admin-pending-save-v2:awards:${resumeId}:${actorA}`;
    const aEnvelope = globalThis.sessionStorage.getItem(aStorageKey)!;
    expect(aEnvelope).toContain("奖项");

    signedInActor = actorB;
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("original Awards snapshot");
    expect(requests).toHaveLength(1);
    expect(globalThis.sessionStorage.getItem(aStorageKey)).toBe(aEnvelope);
    expect(globalThis.sessionStorage.getItem(`admin-pending-save-v2:awards:${resumeId}:${actorB}`)).toBeNull();

    signedInActor = actorA;
    const refreshedRepo = createResumeRepository(supabase as unknown as SupabaseClient);
    expect(refreshedRepo.hasPendingAwardsWorkerSave!(resumeId, actorA)).toBe(true);
    await expect(refreshedRepo.saveAwardsWithWorker!(resumeId, awardDraft)).resolves.toHaveLength(1);
    expect(requests[1]!.body.request_id).toBe(aRequestId);
    expect(requests[1]!.body.awards).toEqual(requests[0]!.body.awards);
    expect(requests[1]!.authorization).toBe(`Bearer token-${actorA}`);
    expect(globalThis.sessionStorage.getItem(aStorageKey)).toBeNull();
  });

  it("does not let another signed-in actor clear a scoped pending PDF upload", async () => {
    let signedInActor = actorA;
    const uploadRequestId = "c1111111-1111-4111-8111-111111111111";
    const objectId = "d1111111-1111-4111-8111-111111111111";
    const reference = `https://storage.example.test/storage/v1/object/public/resume-files/${resumeId}/en/${objectId}.pdf`;
    vi.stubGlobal("crypto", { randomUUID: () => uploadRequestId, subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => Response.json({ reference,
      upload_request_id: new Headers(init.headers).get("X-Upload-Request-ID") })));
    const repo = createResumeRepository(client(() => signedInActor) as unknown as SupabaseClient, "https://storage.example.test");
    const file = new File([new Uint8Array([1, 2, 3])], "resume.pdf", { type: "application/pdf", lastModified: 1 });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
    await repo.uploadResumePdfWithWorker!(resumeId, "en", file);
    const key = `admin-pending-save-v2:files:${resumeId}:${actorA}:upload:en`;
    const pending = globalThis.sessionStorage.getItem(key);
    expect(pending).not.toBeNull();
    signedInActor = actorB;
    await repo.clearPendingResumePdfUpload!(resumeId, "en", uploadRequestId);
    expect(globalThis.sessionStorage.getItem(key)).toBe(pending);
    signedInActor = actorA;
    await repo.clearPendingResumePdfUpload!(resumeId, "en", uploadRequestId);
    expect(globalThis.sessionStorage.getItem(key)).toBeNull();
  });

  it("scopes pending requests by target and domain and retains legacy unbound records", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      throw new Error("uncertain");
    }));
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("uncertain");
    const awardsRequest = requests[0]!.request_id;
    const otherTargetRepo = createResumeRepository(client(() => actorA, secondResumeId) as unknown as SupabaseClient);
    await otherTargetRepo.loadAwards!(secondResumeId);
    await expect(otherTargetRepo.saveAwardsWithWorker!(secondResumeId, awardDraft)).rejects.toThrow("uncertain");
    expect(requests[1]!.request_id).not.toBe(awardsRequest);
    await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).rejects.toThrow("uncertain");
    expect(requests[2]!.request_id).not.toBe(awardsRequest);
    expect(globalThis.sessionStorage.getItem(`admin-pending-save-v2:awards:${resumeId}:${actorA}`)).not.toBeNull();

    const legacyKey = `admin-skills-rpc-pending-v1:${resumeId}`;
    globalThis.sessionStorage.setItem(legacyKey, JSON.stringify({ requestId: "b1111111-1111-4111-8111-111111111111", payload: skillDraft }));
    expect(repo.hasLegacyPendingSkillsSave!(resumeId)).toBe(true);
    const sent = requests.length;
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).rejects.toThrow("retained");
    expect(globalThis.sessionStorage.getItem(legacyKey)).not.toBeNull();
    expect(requests).toHaveLength(sent);
  });

  it("detects an account-bound Skills pending request from before baseline CAS without exposing it to another actor", () => {
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    const key = `admin-pending-save-v2:skills:${resumeId}:${actorA}`;
    globalThis.sessionStorage.setItem(key, JSON.stringify({ actorUserId: actorA, domain: "skills", payloadDigest: "0".repeat(64),
      payload: skillDraft, requestId: "b1111111-1111-4111-8111-111111111111", resumeId }));
    expect(repo.hasPendingSkillsWorkerSave!(resumeId, actorA)).toBe(true);
    expect(repo.hasUnverifiedSkillsPendingSave!(resumeId, actorA)).toBe(true);
    expect(repo.hasPendingSkillsWorkerSave!(resumeId, actorB)).toBe(false);
    expect(repo.hasUnverifiedSkillsPendingSave!(resumeId, actorB)).toBe(false);
    expect(globalThis.sessionStorage.getItem(key)).not.toBeNull();
  });

  it("shows only the active actor's pending state across supported domains", () => {
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    const domains = [
      ["awards", "hasPendingAwardsWorkerSave"], ["skills", "hasPendingSkillsWorkerSave"],
      ["experience", "hasPendingExperienceWorkerSave"], ["education", "hasPendingEducationWorkerSave"],
      ["projects", "hasPendingProjectsWorkerSave"], ["profile", "hasPendingProfileWorkerSave"],
      ["contact", "hasPendingContactWorkerSave"], ["website_links", "hasPendingWebsiteLinksWorkerSave"],
      ["files", "hasPendingFilesWorkerSave"],
    ] as const;
    for (const [domain, method] of domains) {
      const key = "admin-pending-save-v2:" + domain + ":" + resumeId + ":" + actorA;
      globalThis.sessionStorage.setItem(key, "opaque-A-pending");
      const check = repo[method] as (targetId: string, actorId: string | null) => boolean;
      expect(check(resumeId, actorA), domain).toBe(true);
      expect(check(resumeId, actorB), domain).toBe(false);
      expect(check(resumeId, null), domain).toBe(false);
      expect(check(resumeId, "not-a-user-id"), domain).toBe(false);
    }
    const introKey = "admin-pending-save-v2:introduction:" + resumeId + ":" + actorA;
    globalThis.sessionStorage.setItem(introKey, "opaque-A-introduction-pending");
    expect(repo.hasPendingIntroductionWorkerSave!(resumeId, [], actorA)).toBe(true);
    expect(repo.hasPendingIntroductionWorkerSave!(resumeId, [], actorB)).toBe(false);
    expect(globalThis.sessionStorage.getItem(introKey)).toBe("opaque-A-introduction-pending");
  });

  it("retains A pending through A to B to A and keeps two actors' retries independent", async () => {
    let signedInActor = actorA;
    let call = 0;
    const requests: Array<{ requestId: string; awards: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { request_id: string; awards: Array<{ position: number; zh: { name: string; year: string }; en: { name: string; year: string } }> };
      requests.push({ requestId: body.request_id, awards: body.awards });
      call += 1;
      if (call <= 2) throw new Error("lost response");
      return Response.json({ awards: body.awards.map((item, index) => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-" + String(index + 1).padStart(12, "0"),
        position: item.position, zh: item.zh, en: item.en })), baseline_digest: baseline, baseline_proof: "2".repeat(64) });
    }));
    const supabase = client(() => signedInActor);
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("uncertain");
    const aKey = "admin-pending-save-v2:awards:" + resumeId + ":" + actorA;
    const aRequestId = requests[0]!.requestId;
    const aEnvelope = globalThis.sessionStorage.getItem(aKey)!;

    signedInActor = actorB;
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorB)).toBe(false);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorA)).toBe(true);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("uncertain");
    const bKey = "admin-pending-save-v2:awards:" + resumeId + ":" + actorB;
    const bEnvelope = globalThis.sessionStorage.getItem(bKey)!;
    expect(requests[1]!.requestId).not.toBe(aRequestId);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorB)).toBe(true);

    signedInActor = actorA;
    const refreshedRepo = createResumeRepository(supabase as unknown as SupabaseClient);
    expect(refreshedRepo.hasPendingAwardsWorkerSave!(resumeId, actorA)).toBe(true);
    await expect(refreshedRepo.saveAwardsWithWorker!(resumeId, awardDraft)).resolves.toHaveLength(1);
    expect(requests[2]!.requestId).toBe(aRequestId);
    expect(requests[2]!.awards).toEqual(requests[0]!.awards);
    expect(globalThis.sessionStorage.getItem(aKey)).toBeNull();
    expect(globalThis.sessionStorage.getItem(bKey)).toBe(bEnvelope);
    expect(aEnvelope).toContain("奖项");
  });

  it("does not assign or delete a legacy unbound request when no authenticated actor is available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    const legacyKey = "admin-awards-rpc-pending-v1:" + resumeId;
    const legacyValue = JSON.stringify({ requestId: "b1111111-1111-4111-8111-111111111111", payload: awardDraft });
    globalThis.sessionStorage.setItem(legacyKey, legacyValue);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, null)).toBe(false);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorB)).toBe(false);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("retained");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.getItem(legacyKey)).toBe(legacyValue);
  });

  it("does not retry or clear any actor's pending request when the authenticated session is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const actorKey = "admin-pending-save-v2:awards:" + resumeId + ":" + actorA;
    globalThis.sessionStorage.setItem(actorKey, "retained-unverified-pending");
    const supabase = client();
    supabase.auth.getSession = vi.fn(async () => ({ data: { session: null }, error: null })) as never;
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, null)).toBe(false);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("session could not be verified");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.getItem(actorKey)).toBe("retained-unverified-pending");
  });

  it("allows B to save normally while A's actor-bound request remains available to A", async () => {
    let signedInActor = actorA;
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { awards: Array<{ position: number; zh: { name: string; year: string }; en: { name: string; year: string } }> };
      call += 1;
      if (call === 1) throw new Error("A response lost");
      return Response.json({ awards: body.awards.map((item, index) => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-" + String(index + 1).padStart(12, "0"),
        position: item.position, zh: item.zh, en: item.en })), baseline_digest: baseline, baseline_proof: "2".repeat(64) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client(() => signedInActor) as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("uncertain");
    const aKey = "admin-pending-save-v2:awards:" + resumeId + ":" + actorA;
    const aEnvelope = globalThis.sessionStorage.getItem(aKey);
    signedInActor = actorB;
    await repo.loadAwards!(resumeId);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorB)).toBe(false);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).resolves.toHaveLength(1);
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorB)).toBe(false);
    expect(globalThis.sessionStorage.getItem(aKey)).toBe(aEnvelope);
    signedInActor = actorA;
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorA)).toBe(true);
  });

  it("fails closed for a digest-tampered envelope without deleting it or sending a retry", async () => {
    let first = true;
    const fetchMock = vi.fn(async () => { if (first) { first = false; throw new Error("lost"); } return Response.json(canonicalAwardResponse()); });
    vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("uncertain");
    const key = `admin-pending-save-v2:awards:${resumeId}:${actorA}`;
    const raw = globalThis.sessionStorage.getItem(key)!;
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    envelope.payloadDigest = "f".repeat(64);
    globalThis.sessionStorage.setItem(key, JSON.stringify(envelope));
    const count = fetchMock.mock.calls.length;
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("cannot be verified");
    expect(globalThis.sessionStorage.getItem(key)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
});

describe("Awards pending capacity and UTF-8 bounds", () => {
  function makeLegacy8195ByteFixture() {
    const awards = Array.from({ length: 10 }, (_, position) => ({ id: null, position,
      zh: { name: "x".repeat(152), year: "2025" }, en: { name: "x".repeat(152), year: "2025" } }));
    // Three legal string edits adjust the original requestId/resumeId/fingerprint/awards record to 8195 bytes.
    awards[0]!.zh.name = awards[0]!.zh.name.slice(0, -1) + "\n";
    awards[1]!.en.name = awards[1]!.en.name.slice(1);
    awards[2]!.zh.name = awards[2]!.zh.name.slice(0, -1) + "\n";
    return awards;
  }

  function oldAwardsPendingSerialization(awards: unknown[]) {
    return JSON.stringify({ requestId: "b1111111-1111-4111-8111-111111111111", resumeId,
      fingerprint: JSON.stringify(awards), awards });
  }

  it("constructs exactly 8195 UTF-8 bytes of legacy duplicate-fingerprint data from writer-valid Awards", async () => {
    const awards = makeLegacy8195ByteFixture();
    const canonical = JSON.stringify(awards);
    expect(new TextEncoder().encode(canonical).byteLength).toBe(3912);
    expect(awards).toHaveLength(10);
    expect(awards.every((award, position) => Object.keys(award).sort().join(",") === "en,id,position,zh"
      && Object.keys(award.zh).sort().join(",") === "name,year" && Object.keys(award.en).sort().join(",") === "name,year"
      && award.position === position && award.id === null
      && [...award.zh.name].length <= 200 && [...award.en.name].length <= 200
      && award.zh.year.length <= 64 && award.en.year.length <= 64
      && !award.zh.name.includes("\0") && !award.en.name.includes("\0"))).toBe(true);
    expect(new TextEncoder().encode(oldAwardsPendingSerialization(awards)).byteLength).toBe(8195);

    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      if (calls === 1) throw new Error("lost response");
      const request = JSON.parse(String(init.body)) as { awards: typeof awards };
      return Response.json({ awards: request.awards.map((award, index) => ({ ...award,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-" + String(index + 1).padStart(12, "0") })), baseline_digest: baseline, baseline_proof: "2".repeat(64) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    const draft = awards.map((award, position) => ({ id: "local-" + (position + 1), position, sourceKey: null,
      translations: { zh: { name: award.zh.name, year: award.zh.year }, en: { name: award.en.name, year: award.en.year } } }));
    await expect(repo.saveAwardsWithWorker!(resumeId, draft)).rejects.toThrow("uncertain");
    expect(fetchMock).toHaveBeenCalledOnce();
    const stored = globalThis.sessionStorage.getItem("admin-pending-save-v2:awards:" + resumeId + ":" + actorA);
    expect(stored).not.toBeNull();
    expect(new TextEncoder().encode(stored!).byteLength).toBeLessThanOrEqual(8192);
    const envelope = JSON.parse(stored!) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(["actorUserId", "domain", "payload", "payloadDigest", "requestId", "resumeId"]);
    expect(JSON.stringify(envelope)).not.toContain("fingerprint");
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(firstRequest.awards).toEqual(awards);
    await expect(repo.saveAwardsWithWorker!(resumeId, draft)).resolves.toHaveLength(draft.length);
    const replayedRequest = JSON.parse(String(fetchMock.mock.calls[1]![1].body)) as Record<string, unknown>;
    expect(replayedRequest.request_id).toBe(firstRequest.request_id);
    expect(replayedRequest.awards).toEqual(firstRequest.awards);
    expect(globalThis.sessionStorage.getItem("admin-pending-save-v2:awards:" + resumeId + ":" + actorA)).toBeNull();
  });

  it("accepts an exact 4096-byte canonical UTF-8 payload and rejects a 4097-byte payload before sending", async () => {
    const awards = Array.from({ length: 32 }, (_, position) => ({ id: null, position,
      zh: { name: "奖", year: "2025" }, en: { name: "A", year: "2025" } }));
    const canonical = () => JSON.stringify(awards);
    // ASCII and CJK bytes are mixed so this boundary is measured in UTF-8, not JS code units.
    const baseBytes = () => new TextEncoder().encode(canonical()).byteLength;
    let remaining = 4096 - baseBytes();
    for (const award of awards) {
      for (const locale of ["zh", "en"] as const) {
        for (const field of ["name", "year"] as const) {
          if (remaining <= 0) break;
          const limit = field === "name" ? 200 : 64;
          const value = award[locale][field];
          const add = Math.min(limit - [...value].length, remaining);
          if (add > 0) {
            // "x" is one UTF-8 byte, and both selected name fields have sufficient contract capacity.
            award[locale][field] += "x".repeat(add);
            remaining -= add;
          }
        }
        if (remaining <= 0) break;
      }
      if (remaining <= 0) break;
    }
    expect(new TextEncoder().encode(canonical()).byteLength).toBe(4096);
    const draft = awards.map((award, position) => ({ id: "local-" + (position + 1), position, sourceKey: null,
      translations: { zh: award.zh, en: award.en } }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { awards: typeof awards };
      return Response.json({ awards: body.awards.map((award, index) => ({ ...award,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-" + String(index + 1).padStart(12, "0") })), baseline_digest: baseline, baseline_proof: "2".repeat(64) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, draft)).resolves.toHaveLength(32);
    expect(fetchMock).toHaveBeenCalledOnce();

    draft[0]!.translations.zh.year += "x";
    expect(new TextEncoder().encode(JSON.stringify(draft.map((award, position) => ({ id: null, position,
      zh: award.translations.zh, en: award.translations.en })))).byteLength).toBe(4097);
    const sentBeforeOversize = fetchMock.mock.calls.length;
    await expect(repo.saveAwardsWithWorker!(resumeId, draft)).rejects.toThrow("allowed request size");
    expect(fetchMock).toHaveBeenCalledTimes(sentBeforeOversize);
  });

  it("does not dispatch or mutate the draft when pending storage fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const actorBKey = "admin-pending-save-v2:awards:" + resumeId + ":" + actorB;
    globalThis.sessionStorage.setItem(actorBKey, "another-account-pending");
    const storage = globalThis.sessionStorage;
    vi.stubGlobal("sessionStorage", {
      get length() { return storage.length; },
      key: (index: number) => storage.key(index),
      getItem: (key: string) => storage.getItem(key),
      removeItem: (key: string) => storage.removeItem(key),
      clear: () => storage.clear(),
      setItem: (key: string, value: string) => {
        if (key === "admin-pending-save-v2:awards:" + resumeId + ":" + actorA) throw new Error("quota");
        storage.setItem(key, value);
      },
    } as Storage);
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    const draft = structuredClone(awardDraft);
    const before = structuredClone(draft);
    await expect(repo.saveAwardsWithWorker!(resumeId, draft)).rejects.toThrow("could not be stored safely");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.getItem(actorBKey)).toBe("another-account-pending");
    expect(draft).toEqual(before);
  });
  it("fits the maximum canonical payload in one payload envelope while the former duplicate fingerprint exceeds 8192 bytes", async () => {
    const items = Array.from({ length: 32 }, (_, position) => ({ id: `local-1-${position + 1}`, position, sourceKey: null,
      translations: { zh: { name: "奖", year: "2025" }, en: { name: "Award", year: "2025" } } }));
    const toRpc = () => items.map(item => ({ id: null, position: item.position, zh: item.translations.zh, en: item.translations.en }));
    const byteLength = () => new TextEncoder().encode(JSON.stringify(toRpc())).byteLength;
    while (byteLength() <= 4096) {
      const candidate = items.map(item => ({ ...item, translations: { zh: { ...item.translations.zh, name: `${item.translations.zh.name}奖` },
        en: { ...item.translations.en, name: `${item.translations.en.name}x` } } }));
      if (new TextEncoder().encode(JSON.stringify(candidate.map(item => ({ id: null, position: item.position, zh: item.translations.zh, en: item.translations.en })))).byteLength > 4096) break;
      candidate.forEach((item, index) => { items[index] = item; });
    }
    expect(byteLength()).toBeLessThanOrEqual(4096);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { awards: Array<{ position: number; zh: { name: string; year: string }; en: { name: string; year: string } }> };
      return Response.json({ awards: request.awards.map((item, index) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`,
        position: item.position, zh: item.zh, en: item.en })), baseline_digest: baseline, baseline_proof: "2".repeat(64) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, items)).resolves.toHaveLength(32);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as { awards: unknown[] };
    expect(new TextEncoder().encode(JSON.stringify({ awards: request.awards, fingerprint: JSON.stringify(request.awards) })).byteLength).toBeGreaterThan(8192);
    expect(globalThis.sessionStorage.getItem(`admin-pending-save-v2:awards:${resumeId}:${actorA}`)).toBeNull();
  });

  it("rejects oversized UTF-8 content and unavailable hashing or storage before network dispatch", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    const tooLarge = Array.from({ length: 32 }, (_, position) => ({ id: `local-1-${position + 1}`, position, sourceKey: null,
      translations: { zh: { name: "汉".repeat(200), year: "2025" }, en: { name: "A".repeat(200), year: "2025" } } }));
    // One valid request with multibyte content demonstrates byte-based validation, not JS code-unit counting.
    await expect(repo.saveAwardsWithWorker!(resumeId, tooLarge)).rejects.toThrow("allowed request size");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("crypto", { randomUUID: () => "b1111111-1111-4111-8111-111111111111", subtle: undefined });
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("Secure pending-request verification is unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
