import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalizeAwards, handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const requestId = "b1111111-1111-4111-8111-111111111111";
const key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const award = { id: null, position: 0, zh: { name: "奖项", year: "2025" }, en: { name: "Award", year: "2025" } };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function jwt() {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actorId, role: "authenticated" })}.synthetic`;
}
function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return { ASSETS: { fetch: async () => new Response("asset") }, SUPABASE_URL: "https://local.test",
    SUPABASE_PUBLISHABLE_KEY: "synthetic", ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1",
    ACTIVITY_LOG_HMAC_KEY: key, ...overrides };
}
function request(body: unknown, path = "/api/admin/v1/awards/save") {
  return new Request(`https://admin.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function body(overrides: Record<string, unknown> = {}) { return { request_id: requestId, resume_id: resumeId, awards: [award], ...overrides }; }

describe("Activity Log V1.3D Awards Worker", () => {
  it("canonicalizes the frozen field order and proxies only the Awards RPC", async () => {
    expect(canonicalizeAwards([award])).toBe('[{"id":null,"position":0,"zh":{"name":"奖项","year":"2025"},"en":{"name":"Award","year":"2025"}}]');
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const context = JSON.parse(String(payload.signed_context)) as Record<string, unknown>;
      expect(context).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain: "awards", operation: "update", request_id: requestId });
      expect(payload.target_resume_id).toBe(resumeId);
      expect(String(_input)).toBe("https://local.test/rest/v1/rpc/save_resume_awards_v1");
      return Response.json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0 }]);
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body()), env());
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("rejects extra request/item keys, non-contiguous positions, duplicate IDs, and over-limit collections before upstream", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    for (const invalid of [body({ extra: true }), body({ awards: [{ ...award, extra: true }] }),
      body({ awards: [{ ...award, position: 1 }] }), body({ awards: Array.from({ length: 33 }, (_, position) => ({ ...award, position })) })]) {
      expect((await handleWorkerRequest(request(invalid), env())).status).toBeGreaterThanOrEqual(400);
    }
    const duplicateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect((await handleWorkerRequest(request(body({ awards: [{ ...award, id: duplicateId }, { ...award, id: duplicateId, position: 1 }] })), env())).status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("enforces the canonical UTF-8 byte bound", async () => {
    const oversized = Array.from({ length: 32 }, (_, position) => ({ ...award, position, zh: { name: "奖".repeat(200), year: "2025" }, en: { name: "x".repeat(200), year: "2025" } }));
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body({ awards: oversized })), env());
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("maps exact P13B1 to an explicit conflict without invoking V1.3B reporting", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ code: "P13B1" }), { status: 400 }));
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body()), env({ ACTIVITY_LOG_V13B_FAILURE_REPORTING: "true" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("does not fall back to direct writes for upstream errors", async () => {
    const upstream = vi.fn(async () => new Response("{}", { status: 500 })); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body()), env());
    expect(response.status).toBe(502);
    expect(upstream).toHaveBeenCalledOnce();
  });
});
