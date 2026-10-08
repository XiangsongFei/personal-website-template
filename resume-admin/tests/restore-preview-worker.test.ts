import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const qaResumeId = "ea111111-1111-4111-8111-111111111111";
const officialResumeId = "10000000-0000-4000-8000-000000000001";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const actorId = "10000000-0000-4000-8000-000000000002";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function token() {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actorId, role: "authenticated" })}.synthetic`;
}

function env(): WorkerEnv {
  return { ASSETS: { fetch: async () => new Response("asset") }, SUPABASE_URL: "https://local.test", SUPABASE_PUBLISHABLE_KEY: "public-test-key" };
}

function request(body: unknown, authenticated = true) {
  return new Request("https://qa-admin.test/api/admin/v1/restore/preview", { method: "POST", headers: {
    "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token()}` } : {}),
  }, body: JSON.stringify(body) });
}

const state = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0,
  zh: { name: "奖项", year: "2024" }, en: { name: "Award", year: "2024" } }];
const preview = {
  status: "ready", source_event_id: eventId, source_occurred_at: "2026-10-05T02:10:04+00:00", domain: "awards",
  historical_state: state, current_state: [],
  comparison: { before: [], after: state }, expected_current_digest: "a".repeat(64),
};

describe("generic Restore preview Worker route", () => {
  it("requires authentication without contacting PostgREST", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request({ resume_id: qaResumeId, source_event_id: eventId }, false), env());
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["missing source event", { resume_id: qaResumeId }],
    ["malformed event UUID", { resume_id: qaResumeId, source_event_id: "bad-id" }],
    ["injected domain", { resume_id: qaResumeId, source_event_id: eventId, domain: "awards" }],
    ["injected historical state", { resume_id: qaResumeId, source_event_id: eventId, historical_state: state }],
    ["injected current digest", { resume_id: qaResumeId, source_event_id: eventId, expected_current_digest: "b".repeat(64) }],
    ["injected raw audit payload", { resume_id: qaResumeId, source_event_id: eventId, entity_snapshot: { private: true } }],
  ])("rejects %s before any RPC", async (_label, body) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body), env());
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("uses the authenticated target list and only the typed preview RPC", async () => {
    const calls: Array<{ url: string; body: unknown; authorization: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as unknown;
      const headers = new Headers(init?.headers);
      calls.push({ url, body, authorization: headers.get("authorization") });
      if (url.endsWith("/rpc/activity_log_authorized_targets")) return Response.json([{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }]);
      if (url.endsWith("/rpc/preview_restore_v1")) return Response.json(preview);
      return Response.json({ code: "unexpected" }, { status: 404 });
    }));
    const response = await handleWorkerRequest(request({ resume_id: qaResumeId, source_event_id: eventId }), env());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(preview);
    expect(calls.map(call => call.url)).toEqual([
      "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
      "https://local.test/rest/v1/rpc/preview_restore_v1",
    ]);
    expect(calls[0]?.body).toEqual({});
    expect(calls[1]?.body).toEqual({ target_resume_id: qaResumeId, source_event_id: eventId });
    expect(calls.every(call => call.authorization === `Bearer ${token()}`)).toBe(true);
    expect(calls.some(call => /restore_domain_v1|restore_resume_.*_v1|files\/restore/.test(call.url))).toBe(false);
  });

  it("rejects a target mismatch and Official target before preview", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json([{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }]);
    }));
    for (const target of ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", officialResumeId]) {
      const response = await handleWorkerRequest(request({ resume_id: target, source_event_id: eventId }), env());
      expect(response.status).toBe(403);
    }
    expect(calls).toEqual([
      "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
      "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
    ]);
  });

  it("preserves a backend Restore-disabled denial without inheriting QA capability", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/rpc/activity_log_authorized_targets")) return Response.json([{ resume_id: officialResumeId, site_key: "example-cv", role: "owner" }]);
      return Response.json({ code: "42501", message: "Restore is disabled for this target" }, { status: 403 });
    }));
    const response = await handleWorkerRequest(request({ resume_id: officialResumeId, source_event_id: eventId }), env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "restore_disabled" } });
    expect(calls.at(-1)).toBe("https://local.test/rest/v1/rpc/preview_restore_v1");
  });

  it("distinguishes a disabled Activity Log capability using only a safe error category", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/rpc/activity_log_authorized_targets")
      ? Response.json([{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }])
      : Response.json({ code: "42501", message: "Activity Log is disabled for this target" }, { status: 403 })));
    const response = await handleWorkerRequest(request({ resume_id: qaResumeId, source_event_id: eventId }), env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "activity_log_disabled", message: "Version History is not enabled for this target." } });
  });

  it("fails closed on an unexpected preview response and never invokes a mutation RPC", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/rpc/activity_log_authorized_targets")) return Response.json([{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }]);
      return Response.json({ ...preview, actor_user_id: actorId });
    }));
    const response = await handleWorkerRequest(request({ resume_id: qaResumeId, source_event_id: eventId }), env());
    expect(response.status).toBe(502);
    expect(calls).toHaveLength(2);
    expect(calls.every(url => !/restore_domain_v1|restore_resume_.*_v1/.test(url))).toBe(true);
  });

  it("rejects nested private fields, non-contract timestamps, and contradictory status at the Worker boundary", async () => {
    const invalidResponses = [
      { ...preview, historical_state: [{ ...state[0]!, zh: { ...state[0]!.zh, ip_network: "private" } }] },
      { ...preview, source_occurred_at: "October 5, 2026" },
      { ...preview, status: "no_change" },
    ];
    for (const invalid of invalidResponses) {
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/rpc/activity_log_authorized_targets")
        ? Response.json([{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }]) : Response.json(invalid)));
      const response = await handleWorkerRequest(request({ resume_id: qaResumeId, source_event_id: eventId }), env());
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_upstream_response" } });
    }
  });
});
