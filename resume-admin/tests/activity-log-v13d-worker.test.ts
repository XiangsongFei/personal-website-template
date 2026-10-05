import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalizeExperience, canonicalizeSkills, handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const requestId = "d1111111-1111-4111-8111-111111111111";
const key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const experience = { id: null, position: 0,
  zh: { organization: "机构", title: "职位", period: "2024", description: "描述", location: null },
  en: { organization: "Org", title: "Role", period: "2024", description: "Work", location: "" } };
const skills = { id: null, position: 0, zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "English" } };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function jwt() {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actorId, role: "authenticated" })}.synthetic`;
}
function env(): WorkerEnv {
  return { ASSETS: { fetch: async () => new Response("asset") }, SUPABASE_URL: "https://local.test",
    SUPABASE_PUBLISHABLE_KEY: "synthetic", ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1", ACTIVITY_LOG_HMAC_KEY: key };
}
function request(path: string, body: unknown) {
  return new Request(`https://qa-admin.test${path}`, { method: "POST", headers: {
    "Content-Type": "application/json", Authorization: `Bearer ${jwt()}`,
  }, body: JSON.stringify(body) });
}

describe("V1.3D Experience and Skills Worker boundary", () => {
  it("canonicalizes exact Experience and Skills shapes, retaining NULL versus empty location", () => {
    expect(canonicalizeExperience([experience])).toBe('[{"id":null,"position":0,"zh":{"organization":"机构","title":"职位","period":"2024","description":"描述","location":null},"en":{"organization":"Org","title":"Role","period":"2024","description":"Work","location":""}}]');
    expect(canonicalizeSkills([skills])).toBe('[{"id":null,"position":0,"zh":{"title":"语言","items":"中文"},"en":{"title":"Languages","items":"English"}}]');
  });

  it.each([
    ["experience", "/api/admin/v1/experience/save", "canonical_experience", experience],
    ["skills", "/api/admin/v1/skills/save", "canonical_skills", skills],
  ] as const)("signs and proxies %s to its typed RPC only", async (domain, path, canonicalKey, item) => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const context = JSON.parse(String(body.signed_context)) as Record<string, unknown>;
      expect(body.target_resume_id).toBe(resumeId);
      expect(context).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain, operation: "update", request_id: requestId });
      expect(String(input)).toBe(`https://local.test/rest/v1/rpc/save_resume_${domain}_v1`);
      expect(typeof body[canonicalKey]).toBe("string");
      return Response.json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0 }]);
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(path, { request_id: requestId, resume_id: resumeId, [domain]: [item] }), env());
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    ["experience", "/api/admin/v1/experience/save", experience],
    ["skills", "/api/admin/v1/skills/save", skills],
  ] as const)("rejects malformed %s contracts before making an upstream request", async (domain, path, item) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const body = (collection: unknown) => ({ request_id: requestId, resume_id: resumeId, [domain]: collection });
    const malformed = domain === "experience"
      ? [{ ...item, zh: { ...item.zh, extra: true } }]
      : [{ ...item, en: { ...item.en, title: "x".repeat(65) } }];
    expect((await handleWorkerRequest(request(path, body(malformed)), env())).status).toBe(422);
    expect((await handleWorkerRequest(request(path, body(Array.from({ length: 17 }, (_, position) => ({ ...item, position }))),), env())).status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("preserves no-fallback behavior and maps exact P13B1 without side reporting", async () => {
    const upstream = vi.fn(async () => new Response('{"code":"P13B1"}', { status: 400 })); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/experience/save", {
      request_id: requestId, resume_id: resumeId, experience: [experience],
    }), { ...env(), ACTIVITY_LOG_V13B_FAILURE_REPORTING: "true" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
    expect(upstream).toHaveBeenCalledOnce();
  });
});
