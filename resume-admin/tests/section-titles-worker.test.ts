import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const requestId = "dc111111-1111-4111-8111-111111111111";
const key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const titles = { translations: {
  zh: { education_label: "教育", experience_label: "经历", skills_label: "技能", honors_label: "荣誉", project_heading: "项目", kaggle_label: "项目链接" },
  en: { education_label: "Education", experience_label: "Experience", skills_label: "Skills", honors_label: "Awards", project_heading: "Projects", kaggle_label: "Project link" },
} };
const jwt = () => {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actorId, role: "authenticated" })}.synthetic`;
};
const env = (): WorkerEnv => ({ ASSETS: { fetch: async () => new Response("asset") }, SUPABASE_URL: "https://local.test",
  SUPABASE_PUBLISHABLE_KEY: "synthetic", ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1", ACTIVITY_LOG_HMAC_KEY: key });
const request = (body: unknown) => new Request("https://admin.test/api/admin/v1/section-titles/save", { method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` }, body: JSON.stringify(body) });
const body = (overrides: Record<string, unknown> = {}) => ({ request_id: requestId, resume_id: resumeId,
  section_titles: titles, expected_baseline_digest: "1".repeat(64), baseline_proof: "2".repeat(64), ...overrides });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Section Titles Worker", () => {
  it("signs actor, target, domain, request and full bilingual payload for the typed RPC", async () => {
    const upstream = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://local.test/rest/v1/rpc/save_resume_section_titles_v1");
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const signed = JSON.parse(String(payload.signed_context)) as Record<string, unknown>;
      expect(signed).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain: "section_titles", operation: "update",
        request_id: requestId, expected_baseline_digest: "1".repeat(64), baseline_proof: "2".repeat(64) });
      expect(payload.canonical_section_titles).toBe(JSON.stringify(titles));
      return Response.json(titles);
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body()), env());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ section_titles: titles });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("rejects missing, extra, malformed, and oversized title values before forwarding", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const malformed = structuredClone(titles) as { translations: Record<string, Record<string, string>> };
    delete malformed.translations.zh.kaggle_label;
    const extra = { ...titles, translations: { ...titles.translations,
      zh: { ...titles.translations.zh, extra: "x" } } };
    for (const invalid of [body({ unexpected: true }), body({ section_titles: malformed }), body({ section_titles: extra }),
      body({ section_titles: { translations: { zh: { ...titles.translations.zh, skills_label: "x".repeat(1025) }, en: titles.translations.en } } })]) {
      expect((await handleWorkerRequest(request(invalid), env())).status).toBeGreaterThanOrEqual(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("maps database stale-baseline and idempotency conflicts without exposing upstream details", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ code: "P13B2", message: "private database detail" }), { status: 400 }));
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body()), env());
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private database detail");
  });
});
