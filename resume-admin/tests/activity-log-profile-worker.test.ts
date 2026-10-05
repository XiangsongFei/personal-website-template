import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureSections } from "../src/fixtures";
import { profileAggregateFromSection, canonicalizeProfile } from "../src/data/profileAggregate";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const requestId = "d1111111-1111-4111-8111-111111111111";
const signingKey = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const profile = profileAggregateFromSection(fixtureSections.profile);
function token() {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actorId, role: "authenticated" })}.synthetic`;
}
function env(): WorkerEnv {
  return { ASSETS: { fetch: async () => new Response("asset") }, SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "synthetic", ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1", ACTIVITY_LOG_HMAC_KEY: signingKey };
}
function request(body: unknown) {
  return new Request("https://qa-admin.test/api/admin/v1/profile/save", { method: "POST", headers: {
    "Content-Type": "application/json", Authorization: `Bearer ${token()}`,
  }, body: JSON.stringify(body) });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("V1.3D Profile Worker boundary", () => {
  it("signs the exact aggregate and calls only the typed Profile RPC", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const context = JSON.parse(String(body.signed_context)) as Record<string, unknown>;
      expect(String(input)).toBe("https://project.supabase.co/rest/v1/rpc/save_resume_profile_v1");
      expect(body.target_resume_id).toBe(resumeId);
      expect(body.canonical_profile).toBe(canonicalizeProfile(profile));
      expect(context).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain: "profile", operation: "update", request_id: requestId });
      return Response.json(profile);
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request({ request_id: requestId, resume_id: resumeId, baseline_photo_url: profile.shared.photo_url, profile }), env());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual(profile);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...profile, extra: true }, 422],
    [{ ...profile, shared: { ...profile.shared, photo_url: "" } }, 422],
    [{ ...profile, translations: { ...profile.translations, en: { ...profile.translations.en, unexpected: "x" } } }, 422],
    [{ ...profile, translations: { ...profile.translations, zh: { ...profile.translations.zh, name: "x".repeat(200000) } } }, 413],
  ])("rejects malformed/oversized Profile aggregates before upstream access", async (invalid, status) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request({ request_id: requestId, resume_id: resumeId, baseline_photo_url: null, profile: invalid }), env());
    expect(response.status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires a managed path for a changed photo URL but permits an unchanged legacy URL", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { canonical_profile: string };
      return Response.json(JSON.parse(body.canonical_profile) as unknown);
    }); vi.stubGlobal("fetch", upstream);
    const url = `https://project.supabase.co/storage/v1/object/public/profile-images/${resumeId}/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
    const changed = { ...profile, shared: { ...profile.shared, photo_url: url } };
    const allowed = await handleWorkerRequest(request({ request_id: requestId, resume_id: resumeId, baseline_photo_url: null, profile: changed }), env());
    expect(allowed.status).toBe(200);
    const legacy = "https://legacy.example.invalid/old-photo";
    const unchangedLegacy = { ...profile, shared: { ...profile.shared, photo_url: legacy } };
    const preserved = await handleWorkerRequest(request({ request_id: requestId, resume_id: resumeId, baseline_photo_url: legacy, profile: unchangedLegacy }), env());
    expect(preserved.status).toBe(200);
    const rejected = await handleWorkerRequest(request({ request_id: requestId, resume_id: resumeId, baseline_photo_url: null,
      profile: { ...profile, shared: { ...profile.shared, photo_url: "https://outside.invalid/image.webp" } } }), env());
    expect(rejected.status).toBe(422);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
