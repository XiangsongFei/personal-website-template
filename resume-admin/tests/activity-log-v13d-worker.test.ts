import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalizeContact, canonicalizeEducation, canonicalizeExperience, canonicalizeProjects, canonicalizeSkills, handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const requestId = "d1111111-1111-4111-8111-111111111111";
const key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const experience = { id: null, position: 0,
  zh: { organization: "机构", title: "职位", period: "2024", description: "描述", location: null },
  en: { organization: "Org", title: "Role", period: "2024", description: "Work", location: "" } };
const skills = { id: null, position: 0, zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "English" } };
const education = { id: null, position: 0, entry_type: "summerSchool" as const, education_category: null,
  zh: { title: "暑期学校", program: "项目", period: "2025", grade: "A", course_title: null, course_description: "", custom_category_label: null },
  en: { title: "Summer School", program: "Program", period: "2025", grade: "A", course_title: null, course_description: "", custom_category_label: null } };
const projects = [{ id: null, position: 0, zh: { title: "项目", subtitle: "", period: "2025", description: "简介", href: "" },
  en: { title: "Project", subtitle: "", period: "2025", description: "Summary", href: "https://example.test" },
  methods: { zh: [{ id: null, position: 0, value: "规划" }], en: [] } }];
const contact = { translations: { zh: { contact_label: "联系", availability: "交流" }, en: { contact_label: "Contact", availability: "Open" } },
  focus: [{ id: null, position: 0, zh: { title: "项目", detail: "实践" }, en: { title: "Projects", detail: "Practice" } }],
  status: [{ id: null, position: 0, status_type: "open" as const, zh: { title: "开放", detail: "交流" }, en: { title: "Open", detail: "Discuss" } }] };
const websiteLinks = {
  shared: { email: "a@example.test", github: "https://github.test/a", github_label: "GitHub", linkedin_display_name: "Name", email_label: "Email", linkedin_label: "LinkedIn" },
  translations: { zh: { linkedin_label: "领英", linkedin_href: "https://zh.test", portfolio_label: "简历", updated_at_label: "更新" },
    en: { linkedin_label: "LinkedIn", linkedin_href: "https://en.test", portfolio_label: "Resume", updated_at_label: "Updated" } },
  navigation: [0, 1, 2, 3, 4].map((position) => ({ navigation_item_id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${position + 1}`, position,
    zh: { label: `中${position}` }, en: { label: `EN ${position}` } })),
};
const files = { translations: { zh: { portfolio_href: "" }, en: { portfolio_href: "" } } };

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
  it("canonicalizes the exact Contact aggregate, preserves empty strings, and calls only the typed Contact RPC", async () => {
    expect(canonicalizeContact(contact)).toBe(JSON.stringify(contact));
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const context = JSON.parse(String(body.signed_context)) as Record<string, unknown>;
      expect(body.target_resume_id).toBe(resumeId);
      expect(context).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain: "contact", operation: "update", request_id: requestId });
      expect(String(input)).toBe("https://local.test/rest/v1/rpc/save_resume_contact_v1");
      expect(body.canonical_contact).toBe(canonicalizeContact(contact));
      return Response.json({ translations: contact.translations,
        focus: [{ ...contact.focus[0], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
        status: [{ ...contact.status[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }] });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/contact/save", { request_id: requestId, resume_id: resumeId, contact }), env());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...contact, translations: { ...contact.translations, zh: { ...contact.translations.zh, extra: "rejected" } } }, 422],
    [{ ...contact, focus: [{ ...contact.focus[0]!, position: 1 }] }, 422],
    [{ ...contact, status: [{ ...contact.status[0]!, status_type: "other" }] }, 422],
    [{ ...contact, status: [{ ...contact.status[0]!, en: { ...contact.status[0]!.en, detail: "x".repeat(200000) } }] }, 413],
  ])("rejects malformed Contact aggregates before upstream access", async (invalid, status) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/contact/save", { request_id: requestId, resume_id: resumeId, contact: invalid }), env());
    expect(response.status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("maps only the exact Contact idempotency conflict and does not report/fallback", async () => {
    const upstream = vi.fn(async () => new Response('{"code":"P13B1"}', { status: 400 })); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/contact/save", { request_id: requestId, resume_id: resumeId, contact }),
      { ...env(), ACTIVITY_LOG_V13B_FAILURE_REPORTING: "true" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("canonicalizes exact Experience and Skills shapes, retaining NULL versus empty location", () => {
    expect(canonicalizeExperience([experience])).toBe('[{"id":null,"position":0,"zh":{"organization":"机构","title":"职位","period":"2024","description":"描述","location":null},"en":{"organization":"Org","title":"Role","period":"2024","description":"Work","location":""}}]');
    expect(canonicalizeSkills([skills])).toBe('[{"id":null,"position":0,"zh":{"title":"语言","items":"中文"},"en":{"title":"Languages","items":"English"}}]');
  });

  it("canonicalizes Education while preserving the raw legacy NULL category and nullable text", () => {
    expect(canonicalizeEducation([education])).toBe(JSON.stringify([education]));
    const parsed = JSON.parse(canonicalizeEducation([education])) as typeof education[];
    expect(parsed[0].education_category).toBeNull();
    expect(parsed[0].zh.course_title).toBeNull();
    expect(parsed[0].zh.course_description).toBe("");
  });

  it("canonicalizes Projects while preserving empty and locale-specific href values", () => {
    expect(JSON.parse(canonicalizeProjects(projects))).toEqual(projects);
    expect(canonicalizeProjects(projects)).toContain('"href":""');
  });

  it.each([
    ["website_links", "/api/admin/v1/website-links/save", "canonical_website_links", websiteLinks],
    ["files", "/api/admin/v1/files/save", "canonical_files", files],
  ] as const)("signs and proxies %s through its typed RPC only", async (domain, path, canonicalKey, aggregate) => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const context = JSON.parse(String(body.signed_context)) as Record<string, unknown>;
      expect(body.target_resume_id).toBe(resumeId);
      expect(context).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain, operation: "update", request_id: requestId });
      expect(String(input)).toBe(`https://local.test/rest/v1/rpc/save_resume_${domain}_v1`);
      expect(JSON.parse(String(body[canonicalKey]))).toEqual(aggregate);
      return Response.json(aggregate);
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(path, { request_id: requestId, resume_id: resumeId, [domain]: aggregate }), env());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual(aggregate);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    ["website_links", "/api/admin/v1/website-links/save", { ...websiteLinks, navigation: websiteLinks.navigation.slice(0, 4) }],
    ["files", "/api/admin/v1/files/save", { ...files, unexpected: true }],
  ] as const)("rejects malformed %s before upstream access", async (domain, path, aggregate) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(path, { request_id: requestId, resume_id: resumeId, [domain]: aggregate }), env());
    expect(response.status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("enforces representative Education UTF-8, course-description, and collection-count boundaries", async () => {
    const atTitleLimit = { ...education, zh: { ...education.zh, title: `${"界".repeat(85)}x` } }; // exactly 256 UTF-8 bytes
    expect(new TextEncoder().encode(atTitleLimit.zh.title).byteLength).toBe(256);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    const save = async (items: unknown[], id: string) => handleWorkerRequest(request("/api/admin/v1/education/save", {
      request_id: id, resume_id: resumeId, education: items,
    }), env());
    expect((await save([atTitleLimit], "d1111111-1111-4111-8111-111111111112")).status).toBe(200);
    expect((await save([{ ...education, zh: { ...education.zh, title: "界".repeat(86) } }], "d1111111-1111-4111-8111-111111111113")).status).toBe(422);
    expect((await save([{ ...education, zh: { ...education.zh, course_description: "x".repeat(2048) } }], "d1111111-1111-4111-8111-111111111114")).status).toBe(200);
    expect((await save([{ ...education, zh: { ...education.zh, course_description: "x".repeat(2049) } }], "d1111111-1111-4111-8111-111111111115")).status).toBe(422);
    expect((await save(Array.from({ length: 16 }, (_, position) => ({ ...education, position })), "d1111111-1111-4111-8111-111111111116")).status).toBe(200);
    expect((await save(Array.from({ length: 17 }, (_, position) => ({ ...education, position })), "d1111111-1111-4111-8111-111111111117")).status).toBe(422);
  });

  it("signs Education for only the typed education RPC", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const context = JSON.parse(String(body.signed_context)) as Record<string, unknown>;
      expect(context).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain: "education", operation: "update", request_id: requestId });
      expect(String(input)).toBe("https://local.test/rest/v1/rpc/save_resume_education_v1");
      expect(JSON.parse(String(body.canonical_education))).toEqual([education]);
      return Response.json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0 }]);
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/education/save", {
      request_id: requestId, resume_id: resumeId, education: [education],
    }), env());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("signs Projects to its typed RPC with null new IDs, exact hrefs, and bounded nested methods", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const context = JSON.parse(String(body.signed_context)) as Record<string, unknown>;
      expect(context).toMatchObject({ actor_user_id: actorId, resume_id: resumeId, domain: "projects", operation: "update", request_id: requestId });
      expect(String(input)).toBe("https://local.test/rest/v1/rpc/save_resume_projects_v1");
      expect(JSON.parse(String(body.canonical_projects))).toEqual(projects);
      return Response.json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0,
        zh: projects[0]!.zh, en: projects[0]!.en,
        methods: { zh: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0, value: "规划" }], en: [] } }]);
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/projects/save", {
      request_id: requestId, resume_id: resumeId, projects,
    }), env());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...projects[0]!, methods: { ...projects[0]!.methods, zh: [{ id: null, position: 1, value: "out of order" }] } }],
    [{ ...projects[0]!, en: { ...projects[0]!.en, href: "x".repeat(2049) } }],
    [{ ...projects[0]!, methods: { ...projects[0]!.methods, zh: Array.from({ length: 65 }, (_, position) => ({ id: null, position, value: "x" })) } }],
    [{ ...projects[0]!, zh: { ...projects[0]!.zh, extra: "rejected" } }],
  ])("rejects malformed Projects before upstream access and never falls back", async invalid => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/projects/save", {
      request_id: requestId, resume_id: resumeId, projects: invalid,
    }), env());
    expect(response.status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...education, entry_type: "standard", education_category: "summerSchool" }],
    [{ ...education, zh: { ...education.zh, course_description: "x".repeat(2049) } }],
    [{ ...education, en: { ...education.en, extra: "no" } }],
  ])("rejects malformed Education payloads without upstream fallback", async invalid => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request("/api/admin/v1/education/save", {
      request_id: requestId, resume_id: resumeId, education: [invalid],
    }), env());
    expect(response.status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
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
