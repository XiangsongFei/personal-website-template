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

function client(actor: () => string = () => actorA, targetId = resumeId, digest: () => string = () => baseline) {
  return { rpc: vi.fn(async (name: string) => ({ data: [{ resume_id: targetId, activity_log_enabled: true,
    ...(name === "load_admin_skills_write_state" ? { skills_write_mode: "rpc", skills_trusted_context_required: true,
      skills_snapshot: [], skills_baseline_digest: digest(), skills_baseline_proof: "2".repeat(64) }
      : { awards_write_mode: "rpc", awards_trusted_context_required: true, awards_snapshot: [], awards_baseline_digest: digest(), awards_baseline_proof: "2".repeat(64) }) }], error: null })),
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
    await expect(repo.clearPendingResumePdfUpload!(resumeId, "en", uploadRequestId)).rejects.toThrow("cleanup");
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

describe("pending inspection fails closed without assigning legacy ownership", () => {
  const domains = ["introduction", "awards", "experience", "skills", "education", "projects", "profile", "contact", "website_links", "files", "section_titles"] as const;
  it.each(domains)("retains and exposes the %s legacy blocker across accounts and repository reloads", domain => {
    const key = `admin-${domain}-rpc-pending-v1:${resumeId}`;
    sessionStorage.setItem(key, "opaque-original-record");
    for (const actor of [actorA, actorB, null]) {
      const repo = createResumeRepository(client() as unknown as SupabaseClient);
      expect(repo.readPendingSaveState!(domain, resumeId, actor)).toEqual({ status: "legacy", aggregatePending: false, uploadLocales: [] });
      expect(sessionStorage.getItem(key)).toBe("opaque-original-record");
    }
    expect(createResumeRepository(client() as unknown as SupabaseClient).readPendingSaveState!(domain, secondResumeId, actorA).status).toBe("clear");
  });
  it.each(["missing", "getter", "getItem"])("blocks inaccessible storage: %s", kind => {
    if (kind === "missing") vi.stubGlobal("sessionStorage", undefined);
    else if (kind === "getter") vi.spyOn(globalThis, "sessionStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    else vi.stubGlobal("sessionStorage", { getItem() { throw new Error("blocked"); } });
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    for (const domain of domains) expect(repo.readPendingSaveState!(domain, resumeId, actorA).status).toBe("unavailable");
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorA)).toBe(true);
  });
  it("does not classify malformed records as absent, or inspect another actor's payload", () => {
    const key = `admin-pending-save-v2:awards:${resumeId}:${actorA}`;
    sessionStorage.setItem(key, "not-json");
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    expect(repo.readPendingSaveState!("awards", resumeId, actorA).status).toBe("unavailable");
    expect(repo.readPendingSaveState!("awards", resumeId, actorB).status).toBe("clear");
    expect(sessionStorage.getItem(key)).toBe("not-json");
  });
});

describe("definitive rejection versus uncertain replay", () => {
  const failure = (code: string, status = 409) => Response.json({ error: { code, message: "Rejected" } }, { status });
  it("releases an Awards CAS rejection, requires a refresh, and uses a new ID only after review", async () => {
    const requests: string[] = []; const baselines: string[] = []; let currentBaseline = baseline;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)).request_id);
      baselines.push(JSON.parse(String(init.body)).expected_baseline_digest);
      return requests.length === 1 ? failure("awards_baseline_conflict") : Response.json(canonicalAwardResponse());
    }));
    const repo = createResumeRepository(client(() => actorA, resumeId, () => currentBaseline) as unknown as SupabaseClient);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("stale request was not applied");
    expect(repo.hasPendingAwardsWorkerSave!(resumeId, actorA)).toBe(false);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("snapshot could not be verified");
    expect(requests).toHaveLength(1);
    currentBaseline = "3".repeat(64);
    await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).resolves.toHaveLength(1);
    expect(requests[1]).not.toBe(requests[0]);
    expect(baselines).toEqual([baseline, currentBaseline]);
  });
  it.each(["idempotency_conflict", "section_titles_baseline_conflict", "unknown"])("retains Awards on %s", async code => {
    const fetchMock = vi.fn(async () => failure(code)); vi.stubGlobal("fetch", fetchMock);
    const repo = createResumeRepository(client() as unknown as SupabaseClient); await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow();
    const raw = sessionStorage.getItem(`admin-pending-save-v2:awards:${resumeId}:${actorA}`);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow();
    expect(sessionStorage.getItem(`admin-pending-save-v2:awards:${resumeId}:${actorA}`)).toBe(raw);
  });
  it.each(["remove-throws", "replaced", "account-changed"])("cannot release a rejected request when %s", async mode => {
    let actor = actorA;
    const storage = sessionStorage; const key = `admin-pending-save-v2:awards:${resumeId}:${actorA}`;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (mode === "replaced") storage.setItem(key, "replacement-preserved");
      if (mode === "account-changed") actor = actorB;
      return failure("awards_baseline_conflict");
    }));
    if (mode === "remove-throws") vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.getItem(key), setItem: (key: string, value: string) => storage.setItem(key, value),
      removeItem: () => { throw new Error("denied"); },
    });
    const repo = createResumeRepository(client(() => actor) as unknown as SupabaseClient); await repo.loadAwards!(resumeId);
    await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow();
    expect(storage.getItem(key)).not.toBeNull();
    if (mode === "replaced") expect(storage.getItem(key)).toBe("replacement-preserved");
  });
  const experience = [{ id: "local-1", position: 0, sourceKey: null, translations: {
    zh: { organization: "x".repeat(65), title: "Title", period: "Now", description: "", location: null },
    en: { organization: "Org", title: "Title", period: "Now", description: "", location: null },
  } }];
  it("allows a corrected Experience draft only after a first, pre-database validation rejection", async () => {
    const ids: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); ids.push(body.request_id);
      return ids.length === 1 ? failure("invalid_collection", 422) : Response.json(body.experience.map((row: object) => ({ ...row, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })));
    }));
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await expect(repo.saveExperienceWithWorker!(resumeId, experience)).rejects.toThrow("before database execution");
    const corrected = structuredClone(experience); corrected[0].translations.zh.organization = "Fixed";
    await expect(repo.saveExperienceWithWorker!(resumeId, corrected)).resolves.toHaveLength(1);
    expect(ids[1]).not.toBe(ids[0]);
  });
  it.each([[422, "upstream_failure"], [422, "invalid_future_code"], [401, "invalid_authorization"], [429, "invalid_collection"], [409, "invalid_collection"], [500, "invalid_collection"]])("retains uncertain status/code %s %s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => failure(String(code), Number(status))));
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await expect(repo.saveExperienceWithWorker!(resumeId, experience)).rejects.toThrow();
    expect(repo.hasPendingExperienceWorkerSave!(resumeId, actorA)).toBe(true);
  });
  it("does not discard a previously uncertain request when its later retry receives validation rejection", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { if (++calls === 1) throw new Error("lost"); return failure("invalid_collection", 422); }));
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    await expect(repo.saveExperienceWithWorker!(resumeId, experience)).rejects.toThrow();
    const key = `admin-pending-save-v2:experience:${resumeId}:${actorA}`; const original = sessionStorage.getItem(key);
    await expect(repo.saveExperienceWithWorker!(resumeId, experience)).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe(original);
  });
  it("releases only the matching Section Titles CAS request and requires a refreshed baseline", async () => {
    const fields = { education_label: "Education", experience_label: "Experience", skills_label: "Skills", honors_label: "Awards", project_heading: "Projects", kaggle_label: "View" };
    const titles = { translations: { zh: { ...fields }, en: { ...fields } } };
    const supabase = client();
    let currentDigest = baseline; let currentProof = "2".repeat(64);
    Object.assign(supabase, { rpc: vi.fn(async () => ({ data: [{ resume_id: resumeId, activity_log_enabled: true, section_titles_write_mode: "rpc", section_titles_trusted_context_required: true, section_titles_snapshot: titles, section_titles_baseline_digest: currentDigest, section_titles_baseline_proof: currentProof }], error: null })) });
    const ids: string[] = [];
    const sentBaselines: Array<{ digest: string; proof: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      ids.push(body.request_id);
      sentBaselines.push({ digest: body.expected_baseline_digest, proof: body.baseline_proof });
      return ids.length === 1 ? failure("section_titles_baseline_conflict") : Response.json({ section_titles: titles });
    }));
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    await repo.loadAdminSectionTitlesWriteState!(resumeId);
    await expect(repo.saveSectionTitlesWithWorker!(resumeId, titles)).rejects.toThrow("stale request was not applied");
    await expect(repo.saveSectionTitlesWithWorker!(resumeId, titles)).rejects.toThrow("snapshot could not be verified");
    expect(ids).toHaveLength(1);
    currentDigest = "3".repeat(64); currentProof = "4".repeat(64);
    await repo.loadAdminSectionTitlesWriteState!(resumeId);
    await expect(repo.saveSectionTitlesWithWorker!(resumeId, titles)).resolves.toEqual(titles);
    expect(ids[1]).not.toBe(ids[0]);
    expect(sentBaselines).toEqual([{ digest: baseline, proof: "2".repeat(64) }, { digest: currentDigest, proof: currentProof }]);
  });
});

describe("Files upload identities survive reload separately from aggregate pending", () => {
  it.each(["zh", "en"] as const)("reuses the %s upload ID only for the same exact file and actor", async locale => {
    const storageUrl = "https://storage.example.test";
    const headers: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const id = new Headers(init.headers).get("X-Upload-Request-ID")!; headers.push(id);
      return Response.json({ reference: `${storageUrl}/storage/v1/object/public/resume-files/${resumeId}/${locale}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`, upload_request_id: id });
    }));
    const file = new File(["%PDF original"], "original.pdf", { type: "application/pdf", lastModified: 1 });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("%PDF original").buffer });
    const repo = createResumeRepository(client() as unknown as SupabaseClient, storageUrl);
    await repo.uploadResumePdfWithWorker!(resumeId, locale, file);
    const state = repo.readPendingSaveState!("files", resumeId, actorA);
    expect(state).toEqual({ status: "pending", aggregatePending: false, uploadLocales: [locale] });
    const reloaded = createResumeRepository(client() as unknown as SupabaseClient, storageUrl);
    await reloaded.uploadResumePdfWithWorker!(resumeId, locale, file);
    expect(headers[1]).toBe(headers[0]);
    const different = new File(["%PDF other"], "other.pdf", { type: "application/pdf", lastModified: 2 });
    Object.defineProperty(different, "arrayBuffer", { value: async () => new TextEncoder().encode("%PDF other").buffer });
    await expect(reloaded.uploadResumePdfWithWorker!(resumeId, locale, different)).rejects.toThrow("exact file");
    expect(headers).toHaveLength(2);
    expect(reloaded.readPendingSaveState!("files", resumeId, actorB).status).toBe("clear");
    expect(reloaded.readPendingSaveState!("files", secondResumeId, actorA).status).toBe("clear");
  });
});

describe("CAS responses must match the status, domain and complete error envelope", () => {
  const fields = { education_label: "Education", experience_label: "Experience", skills_label: "Skills", honors_label: "Awards", project_heading: "Projects", kaggle_label: "View" };
  const titles = { translations: { zh: fields, en: fields } };
  it.each(["awards", "section_titles"] as const)("retains %s requests for malformed or mismatched responses", async domain => {
    const supabase = client();
    if (domain === "section_titles") Object.assign(supabase, { rpc: vi.fn(async () => ({ data: [{ resume_id: resumeId, activity_log_enabled: true, section_titles_write_mode: "rpc", section_titles_trusted_context_required: true, section_titles_snapshot: titles, section_titles_baseline_digest: baseline, section_titles_baseline_proof: "2".repeat(64) }], error: null })) });
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    if (domain === "awards") await repo.loadAwards!(resumeId); else await repo.loadAdminSectionTitlesWriteState!(resumeId);
    const save = () => domain === "awards" ? repo.saveAwardsWithWorker!(resumeId, awardDraft) : repo.saveSectionTitlesWithWorker!(resumeId, titles);
    const code = `${domain}_baseline_conflict`;
    const responses = [
      new Response("not json", { status: 409 }),
      Response.json({ error: { code } }, { status: 409 }),
      Response.json({ error: { code, message: "Rejected", extra: true } }, { status: 409 }),
      Response.json({ error: { code: "idempotency_conflict", message: "Rejected" } }, { status: 409 }),
      Response.json({ error: { code, message: "Rejected" } }, { status: 422 }),
      Response.json({ error: { code, message: "x".repeat(8200) } }, { status: 409 }),
    ];
    let original: string | null = null;
    for (const response of responses) {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      await expect(save()).rejects.toThrow();
      const raw = sessionStorage.getItem(`admin-pending-save-v2:${domain}:${resumeId}:${actorA}`);
      expect(raw).not.toBeNull();
      if (original) expect(raw).toBe(original); else original = raw;
    }
  });
  it.each(["experience", "skills", "education", "projects"] as const)("releases only a first explicit validation rejection in the shared %s path", async domain => {
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    if (domain === "skills") await repo.loadSkills!(resumeId);
    const ids: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      ids.push(JSON.parse(String(init.body)).request_id);
      return Response.json({ error: { code: "invalid_request", message: "Rejected before RPC" } }, { status: 400 });
    }));
    const save = () => domain === "experience" ? repo.saveExperienceWithWorker!(resumeId, []) : domain === "skills" ? repo.saveSkillsWithWorker!(resumeId, [])
      : domain === "education" ? repo.saveEducationWithWorker!(resumeId, []) : repo.saveProjectsWithWorker!(resumeId, []);
    await expect(save()).rejects.toThrow("before database execution");
    expect(sessionStorage.getItem(`admin-pending-save-v2:${domain}:${resumeId}:${actorA}`)).toBeNull();
    await expect(save()).rejects.toThrow("before database execution");
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });
});

it("does not dispatch when storage replaces the just-created payload under the same request ID", async () => {
  const storage = sessionStorage;
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.getItem(key), removeItem: (key: string) => storage.removeItem(key),
    setItem: (key: string, value: string) => {
      const replacement = JSON.parse(value);
      replacement.payload.awards[0].zh.name = "replacement payload";
      storage.setItem(key, JSON.stringify(replacement));
    },
  });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const repo = createResumeRepository(client() as unknown as SupabaseClient); await repo.loadAwards!(resumeId);
  await expect(repo.saveAwardsWithWorker!(resumeId, awardDraft)).rejects.toThrow("No request was sent");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(storage.getItem(`admin-pending-save-v2:awards:${resumeId}:${actorA}`)).toContain("replacement payload");
});

describe("confirmed Files aggregate replay releases only its uploads", () => {
  it.each([true, false])("preserves upload records until replay confirmation: %s", async confirmed => {
    const storageUrl = "https://storage.example.test";
    let saveCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("/files/upload")) {
        const locale = url.includes("locale=zh") ? "zh" : "en";
        const id = new Headers(init.headers).get("X-Upload-Request-ID")!;
        return Response.json({ reference: `${storageUrl}/storage/v1/object/public/resume-files/${resumeId}/${locale}/${id}.pdf`, upload_request_id: id });
      }
      expect(url).toBe("/api/admin/v1/files/save");
      if (++saveCalls === 1) throw new Error("response lost");
      return confirmed ? Response.json({ files: JSON.parse(String(init.body)).files, cleanup_warning: false }) : new Response(null, { status: 500 });
    }));
    const repo = createResumeRepository(client() as unknown as SupabaseClient, storageUrl);
    const file = new File(["%PDF original"], "original.pdf", { type: "application/pdf", lastModified: 1 });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("%PDF original").buffer });
    const zh = await repo.uploadResumePdfWithWorker!(resumeId, "zh", file);
    const en = await repo.uploadResumePdfWithWorker!(resumeId, "en", file);
    const files = { translations: { zh: { portfolio_href: zh.reference }, en: { portfolio_href: en.reference } } };
    await expect(repo.saveFilesWithWorker!(resumeId, files, { zh: zh.uploadRequestId, en: en.uploadRequestId })).rejects.toThrow("uncertain");
    expect(repo.readPendingSaveState!("files", resumeId, actorA)).toEqual({ status: "pending", aggregatePending: true, uploadLocales: ["zh", "en"] });
    const otherKey = `admin-pending-save-v2:files:${resumeId}:${actorB}:upload:zh`;
    sessionStorage.setItem(otherKey, "other actor protected");
    const before = ["", ":upload:zh", ":upload:en"].map(scope => sessionStorage.getItem(`admin-pending-save-v2:files:${resumeId}:${actorA}${scope}`));
    const reloaded = createResumeRepository(client() as unknown as SupabaseClient, storageUrl);
    if (confirmed) {
      await expect(reloaded.retryPendingFilesWithWorker!(resumeId)).resolves.toEqual({ files, cleanupWarning: false });
      expect(reloaded.readPendingSaveState!("files", resumeId, actorA).status).toBe("clear");
    } else {
      await expect(reloaded.retryPendingFilesWithWorker!(resumeId)).rejects.toThrow("uncertain");
      expect(["", ":upload:zh", ":upload:en"].map(scope => sessionStorage.getItem(`admin-pending-save-v2:files:${resumeId}:${actorA}${scope}`))).toEqual(before);
    }
    expect(sessionStorage.getItem(otherKey)).toBe("other actor protected");
    expect(saveCalls).toBe(2);
  });
});

describe("Files legacy upload keys are unattributed blockers", () => {
  it.each(["zh", "en"] as const)("retains %s upload bytes across actors and reloads", locale => {
    const key = `admin-files-upload-pending-v1:${resumeId}:${locale}`;
    sessionStorage.setItem(key, "opaque-legacy-upload");
    for (const actor of [actorA, actorB, null]) {
      const repo = createResumeRepository(client() as unknown as SupabaseClient);
      expect(repo.readPendingSaveState!("files", resumeId, actor)).toEqual({ status: "legacy", aggregatePending: false, uploadLocales: [] });
      expect(sessionStorage.getItem(key)).toBe("opaque-legacy-upload");
      expect(repo.readPendingSaveState!("files", secondResumeId, actorA).status).toBe("clear");
    }
  });
});

describe("source-confirmed first input rejection matrix", () => {
  // Literal statuses/codes in worker/index.ts: readBoundedBody, collection validators,
  // saveExperienceOrSkills, saveEducation and saveProjects, before their upstream fetch.
  const domainCodes = {
    experience: ["invalid_collection_id", "invalid_experience", "invalid_experience_entry", "invalid_experience_id", "invalid_experience_locale"],
    skills: ["invalid_collection_id", "invalid_skills", "invalid_skill_group", "invalid_skill_id", "invalid_skills_locale", "invalid_skills_baseline"],
    education: ["invalid_education", "invalid_education_entry", "invalid_education_id", "invalid_education_category", "invalid_education_locale"],
    projects: ["invalid_collection_id", "invalid_projects", "invalid_project", "invalid_project_locale", "invalid_project_methods", "invalid_project_method"],
  };
  type Domain = keyof typeof domainCodes;
  const domains = Object.keys(domainCodes) as Domain[];
  const matrix = domains.flatMap(domain => [
    ...["invalid_content_length", "invalid_content_type", "invalid_json", "invalid_request"].map(code => ({ domain, status: 400, code })),
    ...["payload_too_large", "canonical_payload_too_large"].map(code => ({ domain, status: 413, code })),
    ...["invalid_request_id", "invalid_collection", ...domainCodes[domain]].map(code => ({ domain, status: 422, code })),
  ]);
  async function prepare(domain: Domain) {
    const repo = createResumeRepository(client() as unknown as SupabaseClient);
    if (domain === "skills") await repo.loadSkills!(resumeId);
    const save = () => domain === "experience" ? repo.saveExperienceWithWorker!(resumeId, []) : domain === "skills" ? repo.saveSkillsWithWorker!(resumeId, [])
      : domain === "education" ? repo.saveEducationWithWorker!(resumeId, []) : repo.saveProjectsWithWorker!(resumeId, []);
    return { save, key: `admin-pending-save-v2:${domain}:${resumeId}:${actorA}` };
  }
  it.each(matrix)("releases first $domain $status $code and creates a new request", async ({ domain, status, code }) => {
    const { save, key } = await prepare(domain);
    const ids: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      ids.push(JSON.parse(String(init.body)).request_id);
      return Response.json({ error: { code, message: "Rejected" } }, { status });
    }));
    await expect(save()).rejects.toThrow("before database execution");
    expect(sessionStorage.getItem(key)).toBeNull();
    await expect(save()).rejects.toThrow("before database execution");
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });
  it.each(matrix)("retains $domain $code under the wrong HTTP status", async ({ domain, status, code }) => {
    const { save, key } = await prepare(domain);
    const wrongStatus = status === 400 ? 422 : status === 413 ? 400 : 413;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code, message: "Rejected" } }, { status: wrongStatus })));
    await expect(save()).rejects.toThrow();
    const original = sessionStorage.getItem(key);
    expect(original).not.toBeNull();
    await expect(save()).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe(original);
  });
  it.each(matrix)("retains previously uncertain $domain request after $status $code", async ({ domain, status, code }) => {
    const { save, key } = await prepare(domain);
    const ids: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      ids.push(JSON.parse(String(init.body)).request_id);
      if (ids.length === 1) throw new Error("response lost");
      return Response.json({ error: { code, message: "Rejected" } }, { status });
    }));
    await expect(save()).rejects.toThrow("uncertain");
    const original = sessionStorage.getItem(key);
    expect(original).not.toBeNull();
    await expect(save()).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe(original);
    expect(ids).toEqual([ids[0], ids[0]]);
  });
  it.each(domains.flatMap(domain => [400, 413, 422].map(status => ({ domain, status }))))("retains unknown code for $domain HTTP $status", async ({ domain, status }) => {
    const { save, key } = await prepare(domain);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "unknown_input_rejection", message: "Rejected" } }, { status })));
    await expect(save()).rejects.toThrow();
    expect(sessionStorage.getItem(key)).not.toBeNull();
  });
});

describe("Skills CAS exact rejection release", () => {
  const key = `admin-pending-save-v2:skills:${resumeId}:${actorA}`;
  const conflict = () => Response.json({ error: { code: "skills_baseline_conflict", message: "Rejected" } }, { status: 409 });
  it.each(["same-id-payload", "different-id", "actor-change", "actor-change-during-verification", "remove-throws"] as const)("retains the request when %s occurs while awaiting the CAS response", async mode => {
    let actor = actorA; let expected: string | null = null; let responseIssued = false;
    const storage = sessionStorage;
    vi.stubGlobal("fetch", vi.fn(async () => {
      const original = JSON.parse(storage.getItem(key)!);
      if (mode === "same-id-payload") original.payload[0].zh.title = "concurrent replacement";
      if (mode === "different-id") original.requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      if (mode === "same-id-payload" || mode === "different-id") storage.setItem(key, JSON.stringify(original));
      if (mode === "actor-change") actor = actorB;
      expected = storage.getItem(key); responseIssued = true;
      return conflict();
    }));
    if (mode === "remove-throws") vi.stubGlobal("sessionStorage", { getItem: (k: string) => storage.getItem(k), setItem: (k: string, v: string) => storage.setItem(k, v), removeItem: () => { throw new Error("denied"); } });
    const supabase = client(() => actor);
    if (mode === "actor-change-during-verification") supabase.auth.getUser.mockImplementation(async () => {
      const verified = actor;
      if (responseIssued) actor = actorB;
      return { data: { user: { id: verified } }, error: null };
    });
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).rejects.toThrow();
    expect(expected).not.toBeNull(); expect(storage.getItem(key)).toBe(expected);
    const fetchMock = vi.mocked(fetch); const count = fetchMock.mock.calls.length;
    const corrected = structuredClone(skillDraft); corrected[0].translations.zh.title = "new request must remain blocked";
    await expect(repo.saveSkillsWithWorker!(resumeId, corrected)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(count);
    expect(storage.getItem(key)).toBe(expected);
  });
  it.each([
    [409, { error: { code: "skills_baseline_conflict" } }],
    [409, { error: { code: "skills_baseline_conflict", message: "Rejected", extra: true } }],
    [409, { error: { code: "awards_baseline_conflict", message: "Rejected" } }],
    [422, { error: { code: "skills_baseline_conflict", message: "Rejected" } }],
    [500, { error: { code: "skills_baseline_conflict", message: "Rejected" } }],
    [409, { error: { code: "idempotency_conflict", message: "Rejected" } }],
  ])("retains malformed or mismatched CAS response %s %j", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status: Number(status) })));
    const repo = createResumeRepository(client() as unknown as SupabaseClient); await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).rejects.toThrow();
    const original = sessionStorage.getItem(key); expect(original).not.toBeNull();
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe(original);
  });
  it("requires refresh and review before issuing a new Skills request after exact CAS rejection", async () => {
    let digest = baseline; const requests: Array<{ request_id: string; expected_baseline_digest: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); requests.push(body);
      return requests.length === 1 ? conflict() : Response.json(body.skills.map((row: object) => ({ ...row, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })));
    }));
    const repo = createResumeRepository(client(() => actorA, resumeId, () => digest) as unknown as SupabaseClient);
    await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).rejects.toThrow("stale request was not applied");
    expect(sessionStorage.getItem(key)).toBeNull();
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).rejects.toThrow("snapshot could not be verified");
    expect(requests).toHaveLength(1);
    digest = "3".repeat(64); await repo.loadSkills!(resumeId);
    await expect(repo.saveSkillsWithWorker!(resumeId, skillDraft)).resolves.toHaveLength(1);
    expect(requests[1].request_id).not.toBe(requests[0].request_id);
    expect(requests.map(request => request.expected_baseline_digest)).toEqual([baseline, digest]);
  });
});

describe("Section Titles exact replay after a lost committed response", () => {
  const key = `admin-pending-save-v2:section_titles:${resumeId}:${actorA}`;
  function setup() {
    const fields = { education_label: "Education", experience_label: "Experience", skills_label: "Skills", honors_label: "Awards", project_heading: "Projects", kaggle_label: "View" };
    const titles = { translations: { zh: { ...fields }, en: { ...fields } } };
    let actor = actorA; let digest = baseline; let proof = "2".repeat(64);
    const supabase = client(() => actor);
    supabase.rpc = vi.fn(async () => ({ data: [{ resume_id: resumeId, activity_log_enabled: true,
      section_titles_write_mode: "rpc", section_titles_trusted_context_required: true,
      section_titles_snapshot: titles, section_titles_baseline_digest: digest, section_titles_baseline_proof: proof }], error: null })) as never;
    const repo = createResumeRepository(supabase as unknown as SupabaseClient);
    const requests: Record<string, unknown>[] = [];
    // This map models committed idempotency results; it is not a real database or audit assertion.
    const committed = new Map<string, string>(); let auditCount = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); requests.push(body);
      const canonical = JSON.stringify(body);
      if (!committed.has(body.request_id)) { committed.set(body.request_id, canonical); auditCount++; }
      else expect(committed.get(body.request_id)).toBe(canonical);
      digest = "3".repeat(64); proof = "4".repeat(64);
      if (requests.length === 1) throw new Error("synthetic response lost after commit");
      return Response.json({ section_titles: titles });
    });
    vi.stubGlobal("fetch", fetchMock);
    return { repo, supabase, titles, requests, fetchMock, auditCount: () => auditCount,
      changeActor: () => { actor = actorB; },
      async loseAndReload() {
        await repo.loadAdminSectionTitlesWriteState!(resumeId);
        await expect(repo.saveSectionTitlesWithWorker!(resumeId, titles)).rejects.toThrow("uncertain");
        const raw = sessionStorage.getItem(key)!; expect(raw).not.toBeNull();
        const refreshed = await repo.loadAdminSectionTitlesWriteState!(resumeId);
        expect(refreshed.baselineDigest).toBe("3".repeat(64)); expect(refreshed.baselineProof).toBe("4".repeat(64));
        expect(sessionStorage.getItem(key)).toBe(raw); return raw;
      } };
  }
  it("replays the original request and proof after refreshing a committed baseline, then clears only after confirmation", async () => {
    const s = setup(); const raw = await s.loseAndReload();
    let release!: () => void; const originalFetch = s.fetchMock.getMockImplementation()!;
    s.fetchMock.mockImplementation(async (url, init) => { await new Promise<void>(resolve => { release = resolve; }); return originalFetch(url, init); });
    const saving = s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles);
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(sessionStorage.getItem(key)).toBe(raw);
    release(); await expect(saving).resolves.toEqual(s.titles);
    expect(s.requests).toHaveLength(2); expect(s.requests[1]).toEqual(s.requests[0]);
    expect(s.requests[1].expected_baseline_digest).toBe(baseline); expect(s.requests[1].baseline_proof).toBe("2".repeat(64));
    expect(s.auditCount()).toBe(1); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("replays after Repository recreation without adopting the refreshed proof", async () => {
    const s = setup(); const raw = await s.loseAndReload();
    const reloaded = createResumeRepository(s.supabase as unknown as SupabaseClient);
    await reloaded.loadAdminSectionTitlesWriteState!(resumeId);
    expect(sessionStorage.getItem(key)).toBe(raw);
    await expect(reloaded.saveSectionTitlesWithWorker!(resumeId, s.titles)).resolves.toEqual(s.titles);
    expect(s.requests[1]).toEqual(s.requests[0]); expect(s.auditCount()).toBe(1);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("still refuses a fresh request with a stale expected snapshot and preserves an empty store", async () => {
    const s = setup(); await s.repo.loadAdminSectionTitlesWriteState!(resumeId);
    const stale = structuredClone(s.titles); stale.translations.zh.skills_label = "old baseline";
    await expect(s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles, stale)).rejects.toThrow("changed since this draft");
    expect(s.fetchMock).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it.each(["idempotency-conflict", "other-domain", "5xx", "malformed", "actor", "replacement", "remove-throws"] as const)("retains the original or replacement on replay %s", async kind => {
    const s = setup(); const raw = await s.loseAndReload(); let protectedRaw = raw;
    s.fetchMock.mockImplementation(async () => {
      if (kind === "actor") s.changeActor();
      if (kind === "replacement") { const replacement = JSON.parse(raw); replacement.payload.titles.translations.zh.skills_label = "new protected payload"; protectedRaw = JSON.stringify(replacement); sessionStorage.setItem(key, protectedRaw); }
      if (kind === "idempotency-conflict" || kind === "other-domain") return Response.json({ error: { code: kind === "other-domain" ? "awards_baseline_conflict" : "idempotency_conflict", message: "Rejected" } }, { status: 409 });
      if (kind === "5xx") return new Response(null, { status: 503 });
      if (kind === "malformed") return Response.json({ section_titles: [] });
      return Response.json({ section_titles: s.titles });
    });
    if (kind === "remove-throws") vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    await expect(s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles)).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe(protectedRaw);
  });
  it("releases only a genuine Section Titles baseline-conflict and requires a new verified baseline", async () => {
    const s = setup(); await s.loseAndReload();
    s.fetchMock.mockResolvedValue(Response.json({ error: { code: "section_titles_baseline_conflict", message: "Rejected" } }, { status: 409 }));
    await expect(s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles)).rejects.toThrow("stale request was not applied");
    expect(sessionStorage.getItem(key)).toBeNull();
    await expect(s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles)).rejects.toThrow("snapshot could not be verified");
    expect(s.fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["same-id-payload", "different-id", "digest", "actor"] as const)("does not dispatch if %s changes during replay verification", async kind => {
    const s = setup(); const raw = await s.loseAndReload(); let protectedRaw = raw; let checks = 0;
    s.supabase.auth.getUser.mockImplementation(async () => {
      if (++checks === 2) {
        if (kind === "actor") s.changeActor();
        else {
          const value = JSON.parse(raw);
          if (kind === "same-id-payload") value.payload.titles.translations.zh.skills_label = "replacement";
          if (kind === "different-id") value.requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
          if (kind === "digest") value.payloadDigest = "f".repeat(64);
          protectedRaw = JSON.stringify(value); sessionStorage.setItem(key, protectedRaw);
        }
      }
      return { data: { user: { id: actorA } }, error: null };
    });
    await expect(s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles)).rejects.toThrow();
    expect(s.fetchMock).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBe(protectedRaw);
  });
  it.each(["digest", "missing-proof", "invalid-proof", "invalid-baseline", "request-id", "target", "domain", "owner"] as const)("retains invalid replay envelope %s without a request", async kind => {
    const s = setup(); const raw = await s.loseAndReload(); const value = JSON.parse(raw);
    if (kind === "digest") value.payloadDigest = "f".repeat(64);
    if (kind === "missing-proof") delete value.payload.baselineProof;
    if (kind === "invalid-proof") value.payload.baselineProof = "unverified";
    if (kind === "invalid-baseline") value.payload.expectedBaselineDigest = "unverified";
    if (kind === "request-id") value.requestId = "not-a-uuid";
    if (kind === "target") value.resumeId = secondResumeId;
    if (kind === "domain") value.domain = "awards";
    if (kind === "owner") value.actorUserId = actorB;
    if (kind !== "digest") {
      const bound = { actorUserId: value.actorUserId, domain: value.domain, resumeId: value.resumeId, requestId: value.requestId, payload: value.payload };
      value.payloadDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(bound)))), byte => byte.toString(16).padStart(2, "0")).join("");
    }
    const protectedRaw = JSON.stringify(value); sessionStorage.setItem(key, protectedRaw);
    await expect(s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles)).rejects.toThrow();
    expect(s.fetchMock).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBe(protectedRaw);
  });
  it.each((["new", "replay"] as const).flatMap(path => (["legacy", "unavailable", "replacement", "actor", "missing", "throws", "undefined", "malformed"] as const).map(kind => ({ path, kind }))))("blocks $path dispatch when $kind appears during final authentication", async ({ path, kind }) => {
    const s = setup();
    if (path === "replay") await s.loseAndReload(); else await s.repo.loadAdminSectionTitlesWriteState!(resumeId);
    s.fetchMock.mockClear();
    let release!: () => void; let checks = 0;
    s.supabase.auth.getUser.mockImplementation(async () => {
      if (++checks === 2) await new Promise<void>(resolve => { release = resolve; });
      return { data: { user: { id: actorA } }, error: null };
    });
    const saving = s.repo.saveSectionTitlesWithWorker!(resumeId, s.titles);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    if (kind === "legacy") sessionStorage.setItem(`admin-section_titles-rpc-pending-v1:${resumeId}`, "unattributed original");
    if (kind === "replacement") sessionStorage.setItem(key, JSON.stringify({ actorUserId: actorA, domain: "section_titles", resumeId,
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", payloadDigest: "f".repeat(64), payload: { protected: true } }));
    if (kind === "actor") s.changeActor();
    const before = sessionStorage.getItem(key); const draft = structuredClone(s.titles);
    if (kind === "unavailable") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    if (kind === "missing") delete s.repo.readPendingSaveState;
    if (kind === "throws") s.repo.readPendingSaveState = () => { throw new Error("unreadable"); };
    if (kind === "undefined" || kind === "malformed") s.repo.readPendingSaveState = () => (kind === "undefined" ? undefined : { status: "pending" }) as never;
    release(); await expect(saving).rejects.toThrow();
    expect(s.fetchMock).not.toHaveBeenCalled(); expect(s.titles).toEqual(draft);
    vi.restoreAllMocks(); expect(sessionStorage.getItem(key)).toBe(before);
    if (kind === "legacy") expect(sessionStorage.getItem(`admin-section_titles-rpc-pending-v1:${resumeId}`)).toBe("unattributed original");
  });

});

describe("Files cleanup binds the complete upload snapshot", () => {
  async function prepare() {
    let actor = actorA; let lost = true;
    const supabase = client(() => actor);
    const repo = createResumeRepository(supabase as unknown as SupabaseClient, "https://storage.example.test");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("/upload")) {
        const locale = url.includes("locale=zh") ? "zh" : "en";
        const id = new Headers(init.headers).get("X-Upload-Request-ID")!;
        return Response.json({ reference: `https://storage.example.test/storage/v1/object/public/resume-files/${resumeId}/${locale}/${id}.pdf`, upload_request_id: id });
      }
      if (lost) { lost = false; throw new Error("response lost"); }
      return Response.json({ files: JSON.parse(String(init.body)).files, cleanup_warning: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["%PDF original"], "original.pdf", { type: "application/pdf", lastModified: 1 });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("%PDF original").buffer });
    const zh = await repo.uploadResumePdfWithWorker!(resumeId, "zh", file);
    const en = await repo.uploadResumePdfWithWorker!(resumeId, "en", file);
    const key = (locale: string) => `admin-pending-save-v2:files:${resumeId}:${actorA}:upload:${locale}`;
    const aggregate = `admin-pending-save-v2:files:${resumeId}:${actorA}`;
    const files = { translations: { zh: { portfolio_href: zh.reference }, en: { portfolio_href: en.reference } } };
    return { repo, supabase, fetchMock, key, aggregate, files, zh, en, switchActor() { actor = actorB; } };
  }
  it.each(["different-id", "payload", "binding", "digest"] as const)("retains replacement during digest validation: %s", async kind => {
    const s = await prepare(); const key = s.key("zh"); const original = sessionStorage.getItem(key)!;
    const value = JSON.parse(original);
    if (kind === "different-id") value.requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    if (kind === "payload") value.payload.fileName = "replacement.pdf";
    if (kind === "binding") value.resumeId = secondResumeId;
    if (kind === "digest") value.payloadDigest = "f".repeat(64);
    const replacement = JSON.stringify(value);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => { sessionStorage.setItem(key, replacement); return digest(...args); });
    await expect(s.repo.clearPendingResumePdfUpload!(resumeId, "zh", s.zh.uploadRequestId)).rejects.toThrow("cleanup");
    expect(sessionStorage.getItem(key)).toBe(replacement);
    expect(s.fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["target", "locale", "read", "malformed", "delete", "silent-delete", "actor"] as const)("refuses unsafe cleanup: %s", async kind => {
    const s = await prepare(); const key = s.key("zh"); let expected = sessionStorage.getItem(key)!;
    if (kind === "malformed") { expected = "not-json"; sessionStorage.setItem(key, expected); }
    if (kind === "actor") s.switchActor();
    if (kind === "read") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    if (kind === "delete") vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    if (kind === "silent-delete") vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    await expect(s.repo.clearPendingResumePdfUpload!(kind === "target" ? secondResumeId : resumeId, kind === "locale" ? "en" : "zh", s.zh.uploadRequestId)).rejects.toThrow("cleanup");
    vi.restoreAllMocks(); expect(sessionStorage.getItem(key)).toBe(expected);
  });
  it("retains aggregate and remaining upload after partial cleanup, then replays without uploading", async () => {
    const s = await prepare();
    await expect(s.repo.saveFilesWithWorker!(resumeId, s.files, { zh: s.zh.uploadRequestId, en: s.en.uploadRequestId })).rejects.toThrow();
    const original = sessionStorage.getItem(s.aggregate); const en = sessionStorage.getItem(s.key("en"));
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === s.key("en")) throw new Error("blocked"); remove.call(this, key);
    });
    await expect(s.repo.retryPendingFilesWithWorker!(resumeId)).rejects.toThrow("cleanup");
    expect(sessionStorage.getItem(s.key("zh"))).toBeNull(); expect(sessionStorage.getItem(s.key("en"))).toBe(en);
    expect(sessionStorage.getItem(s.aggregate)).toBe(original);
    vi.restoreAllMocks();
    const reloaded = createResumeRepository(s.supabase as unknown as SupabaseClient, "https://storage.example.test");
    await expect(reloaded.retryPendingFilesWithWorker!(resumeId)).resolves.toEqual({ files: s.files, cleanupWarning: false });
    expect(sessionStorage.getItem(s.aggregate)).toBeNull(); expect(sessionStorage.getItem(s.key("en"))).toBeNull();
    expect(s.fetchMock.mock.calls.filter(([url]) => url.includes("/upload"))).toHaveLength(2);
    const bodies = s.fetchMock.mock.calls.filter(([url]) => url.endsWith("/save")).map(([, init]) => init.body);
    expect(new Set(bodies).size).toBe(1);
  });
  it("retains both uploads and the aggregate when actor changes after aggregate confirmation", async () => {
    const s = await prepare();
    await expect(s.repo.saveFilesWithWorker!(resumeId, s.files, { zh: s.zh.uploadRequestId, en: s.en.uploadRequestId })).rejects.toThrow();
    const keys = [s.aggregate, s.key("zh"), s.key("en")]; const original = keys.map(k => sessionStorage.getItem(k));
    s.fetchMock.mockImplementation(async () => { s.switchActor(); return Response.json({ files: s.files, cleanup_warning: false }); });
    await expect(s.repo.retryPendingFilesWithWorker!(resumeId)).rejects.toThrow("cleanup");
    expect(keys.map(k => sessionStorage.getItem(k))).toEqual(original);
  });
  it.each(["request-id", "payload", "actor-binding", "target-binding", "locale-binding", "malformed", "read", "delete", "silent-delete", "account-switch", "legacy-bindings", "matching"] as const)("rebuilds Repository and protects persisted upload binding: %s", async kind => {
    const s = await prepare();
    await expect(s.repo.saveFilesWithWorker!(resumeId, s.files, { zh: s.zh.uploadRequestId, en: s.en.uploadRequestId })).rejects.toThrow("uncertain");
    const key = s.key("zh"); const originalUpload = sessionStorage.getItem(key)!;
    const originalAggregate = sessionStorage.getItem(s.aggregate)!;
    const aggregate = JSON.parse(originalAggregate);
    expect(aggregate.payload.uploadBindings.zh).toBe(originalUpload);
    expect(aggregate.payload.uploadBindings.en).toBe(sessionStorage.getItem(s.key("en")));
    async function redigest(value: Record<string, unknown>) {
      const { actorUserId, domain, resumeId: target, requestId, payload } = value;
      value.payloadDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ actorUserId, domain, resumeId: target, requestId, payload })))), byte => byte.toString(16).padStart(2, "0")).join("");
      return JSON.stringify(value);
    }
    let protectedUpload = originalUpload; let protectedAggregate = originalAggregate;
    if (["request-id", "payload", "actor-binding", "target-binding", "locale-binding"].includes(kind)) {
      const replaced = JSON.parse(originalUpload);
      if (kind === "request-id") replaced.requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      if (kind === "payload") replaced.payload.fileName = "replacement.pdf";
      if (kind === "actor-binding") replaced.actorUserId = actorB;
      if (kind === "target-binding") replaced.resumeId = secondResumeId;
      if (kind === "locale-binding") replaced.payload.locale = "en";
      protectedUpload = await redigest(replaced);
      expect(JSON.parse(protectedUpload).payloadDigest).not.toBe(JSON.parse(originalUpload).payloadDigest);
      sessionStorage.setItem(key, protectedUpload);
    }
    if (kind === "malformed") { protectedUpload = "malformed protected record"; sessionStorage.setItem(key, protectedUpload); }
    if (kind === "legacy-bindings") {
      delete aggregate.payload.uploadBindings;
      protectedAggregate = await redigest(aggregate); sessionStorage.setItem(s.aggregate, protectedAggregate);
    }
    const originalFetch = s.fetchMock.getMockImplementation()!;
    s.fetchMock.mockImplementation(async (url, init) => {
      const result = await originalFetch(url, init);
      if (kind === "account-switch") s.switchActor();
      if (kind === "read") {
        const get = Storage.prototype.getItem;
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) { if (k === key) throw new Error("unavailable"); return get.call(this, k); });
      }
      return result;
    });
    if (kind === "delete" || kind === "silent-delete") {
      const remove = Storage.prototype.removeItem;
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, k: string) {
        if (k === key) { if (kind === "delete") throw new Error("blocked"); return; } remove.call(this, k);
      });
    }
    const reloaded = createResumeRepository(s.supabase as unknown as SupabaseClient, "https://storage.example.test");
    if (kind === "matching") await expect(reloaded.retryPendingFilesWithWorker!(resumeId)).resolves.toEqual({ files: s.files, cleanupWarning: false });
    else await expect(reloaded.retryPendingFilesWithWorker!(resumeId)).rejects.toThrow("cleanup");
    vi.restoreAllMocks();
    expect(sessionStorage.getItem(key)).toBe(kind === "matching" ? null : protectedUpload);
    expect(sessionStorage.getItem(s.aggregate)).toBe(kind === "matching" ? null : protectedAggregate);
    const saves = s.fetchMock.mock.calls.filter(([url]) => url.endsWith("/save"));
    expect(saves).toHaveLength(kind === "legacy-bindings" ? 1 : 2);
    if (saves.length === 2) expect(saves[1][1].body).toBe(saves[0][1].body);
    expect(s.fetchMock.mock.calls.filter(([url]) => url.includes("/upload"))).toHaveLength(2);
  });

});
