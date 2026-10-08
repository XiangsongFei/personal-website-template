import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, signContext, type WorkerEnv } from "../src/worker/index";

const qaResumeId = "ea111111-1111-4111-8111-111111111111";
const officialResumeId = "10000000-0000-4000-8000-000000000001";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorId = "10000000-0000-4000-8000-000000000002";
const digest = "a".repeat(64);
const signingKey = "ab".repeat(32);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function token() {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actorId, role: "authenticated" })}.synthetic`;
}
function env(): WorkerEnv {
  return { ASSETS: { fetch: async () => new Response("asset") }, SUPABASE_URL: "https://local.test", SUPABASE_PUBLISHABLE_KEY: "publishable",
    ACTIVITY_LOG_HMAC_KEY_ID: "restore-test-key", ACTIVITY_LOG_HMAC_KEY: signingKey };
}
function request(body: unknown, authenticated = true) {
  return new Request("https://qa-admin.test/api/admin/v1/restore/apply", { method: "POST", headers: {
    "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token()}` } : {}),
  }, body: JSON.stringify(body) });
}
const mutation = { resume_id: qaResumeId, source_event_id: eventId, expected_current_digest: digest, request_id: requestId };
const restored = { status: "restored", domain: "awards", source_event_id: eventId,
  result_event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", occurred_at: "2026-10-08T02:10:04+00:00" };

function mockRpc(final = Response.json(restored), targets = [{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }], resolvedDomain: unknown = "awards") {
  const calls: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, body, authorization: headers.get("authorization") });
    if (url.endsWith("/rpc/activity_log_authorized_targets")) return Response.json(targets);
    if (url.endsWith("/rpc/resolve_restore_domain_v1")) return Response.json(resolvedDomain);
    if (url.endsWith("/rpc/restore_domain_v1")) return final;
    return Response.json({ code: "unexpected" }, { status: 404 });
  }));
  return calls;
}

describe("generic Restore mutation Worker route", () => {
  it("requires an authenticated user before any RPC", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(mutation, false), env());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and non-JSON media types without contacting PostgREST", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const malformed = await handleWorkerRequest(new Request("https://qa-admin.test/api/admin/v1/restore/apply", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }, body: "{" }), env());
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("cache-control")).toBe("no-store");
    const wrongType = await handleWorkerRequest(new Request("https://qa-admin.test/api/admin/v1/restore/apply", {
      method: "POST", headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token()}` }, body: JSON.stringify(mutation) }), env());
    expect(wrongType.status).toBe(400);
    expect(wrongType.headers.get("cache-control")).toBe("no-store");
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["missing field", { resume_id: qaResumeId, source_event_id: eventId, request_id: requestId }],
    ["extra domain", { ...mutation, domain: "awards" }],
    ["browser actor", { ...mutation, actor_user_id: actorId }],
    ["browser signature", { ...mutation, signature_hex: "f".repeat(64) }],
    ["wrong type", { ...mutation, request_id: 7 }],
    ["bad target UUID", { ...mutation, resume_id: "bad" }],
    ["bad source UUID", { ...mutation, source_event_id: "bad" }],
    ["bad request UUID", { ...mutation, request_id: "bad" }],
    ["uppercase/non-hex digest", { ...mutation, expected_current_digest: "A".repeat(64) }],
    ["short digest", { ...mutation, expected_current_digest: "a".repeat(63) }],
  ])("rejects %s before contacting PostgREST", async (_label, body) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(body), env());
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a body over 4 KiB", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(new Request("https://qa-admin.test/api/admin/v1/restore/apply", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ ...mutation, padding: "x".repeat(5000) }),
    }), env());
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("authorizes target, resolves domain server-side without Preview, signs the exact request, and calls Restore with the user JWT", async () => {
    const calls = mockRpc();
    const response = await handleWorkerRequest(request(mutation), env());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(restored);
    expect(calls.map(call => call.url)).toEqual([
      "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
      "https://local.test/rest/v1/rpc/resolve_restore_domain_v1",
      "https://local.test/rest/v1/rpc/restore_domain_v1",
    ]);
    expect(calls.every(call => call.authorization === `Bearer ${token()}`)).toBe(true);
    expect(calls[1]?.body).toEqual({ target_resume_id: qaResumeId, source_event_id: eventId });
    expect(calls[2]?.body).toMatchObject({ target_resume_id: qaResumeId, source_event_id: eventId,
      expected_current_digest: digest, request_id: requestId });
    expect(Object.keys(calls[2]!.body).sort()).toEqual(["expected_current_digest", "request_id", "signature_hex", "signed_context", "source_event_id", "target_resume_id"]);
    const signedContext = JSON.parse(String(calls[2]?.body.signed_context)) as Record<string, unknown>;
    expect(Object.keys(signedContext).sort()).toEqual(["actor_user_id", "context_version", "domain", "expected_current_digest", "expires_at", "issued_at", "key_id", "operation", "request_id", "resume_id", "source_event_id"]);
    expect(signedContext).toMatchObject({ context_version: 1, key_id: "restore-test-key", actor_user_id: actorId, resume_id: qaResumeId,
      domain: "awards", operation: "restore", request_id: requestId, source_event_id: eventId, expected_current_digest: digest });
    expect(typeof calls[2]?.body.signature_hex).toBe("string");
    expect(calls[2]?.body.signature_hex).toMatch(/^[0-9a-f]{64}$/);
    const key = new Uint8Array(signingKey.match(/../g)!.map(byte => Number.parseInt(byte, 16)));
    expect(calls[2]?.body.signature_hex).toBe((await signContext(signedContext as unknown as Parameters<typeof signContext>[0], key)).signatureHex);
    expect(calls[2]?.body).not.toHaveProperty("domain");
    expect(calls[2]?.body).not.toHaveProperty("actor_user_id");
  });

  it("preserves the original digest and request ID through resolver and mutation", async () => {
    const calls = mockRpc(Response.json({ status: "no_change", domain: "awards", source_event_id: eventId, result_event_id: null }));
    const response = await handleWorkerRequest(request(mutation), env());
    expect(response.status).toBe(200);
    expect(calls[1]?.body).toEqual({ target_resume_id: qaResumeId, source_event_id: eventId });
    expect(calls[2]?.body.expected_current_digest).toBe(digest);
    expect(calls[2]?.body.request_id).toBe(requestId);
  });

  it.each(["awards", "experience", "skills", "education", "projects", "contact", "website_links"] as const)(
    "accepts the allowed scalar domain %s and signs that resolver result", async domain => {
      const calls = mockRpc(Response.json({ status: "no_change", domain, source_event_id: eventId, result_event_id: null }),
        [{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }], domain);
      const response = await handleWorkerRequest(request(mutation), env());
      expect(response.status).toBe(200);
      expect(calls[1]?.url).toBe("https://local.test/rest/v1/rpc/resolve_restore_domain_v1");
      expect(calls[2]?.url).toBe("https://local.test/rest/v1/rpc/restore_domain_v1");
      const signedContext = JSON.parse(String(calls[2]?.body.signed_context)) as Record<string, unknown>;
      expect(signedContext.domain).toBe(domain);
      expect(calls[2]?.body.domain).toBeUndefined();
    },
  );

  it.each([null, ["awards"], { domain: "awards" }, 7, true, "", "unknown"])(
    "fails closed for malformed resolver output %j without calling Restore", async resolverValue => {
      const calls = mockRpc(Response.json(restored), undefined, resolverValue);
      const response = await handleWorkerRequest(request(mutation), env());
      expect(response.status).toBe(502);
      expect(calls.map(call => call.url)).toEqual([
        "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
        "https://local.test/rest/v1/rpc/resolve_restore_domain_v1",
      ]);
    },
  );

  it("does not call Restore when the resolver rejects authorization or source eligibility", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/rpc/activity_log_authorized_targets")) return Response.json([{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }]);
      if (url.endsWith("/rpc/resolve_restore_domain_v1")) return Response.json({ code: "22023", message: "Restore source is not eligible" }, { status: 400 });
      return Response.json(restored);
    }));
    const response = await handleWorkerRequest(request(mutation), env());
    expect(response.status).toBe(422);
    expect(calls).toEqual([
      "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
      "https://local.test/rest/v1/rpc/resolve_restore_domain_v1",
    ]);
  });

  it("reaches the idempotent Restore replay path without Preview or current-aggregate dependency", async () => {
    const replayResult = { status: "restored", domain: "awards", source_event_id: eventId,
      result_event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", occurred_at: "2026-10-08T02:10:04+00:00" };
    const calls = mockRpc(Response.json(replayResult));
    const response = await handleWorkerRequest(request(mutation), env());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(replayResult);
    expect(calls.map(call => call.url)).toEqual([
      "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
      "https://local.test/rest/v1/rpc/resolve_restore_domain_v1",
      "https://local.test/rest/v1/rpc/restore_domain_v1",
    ]);
    expect(calls[2]?.body).toMatchObject({ target_resume_id: qaResumeId, source_event_id: eventId,
      expected_current_digest: digest, request_id: requestId });
    expect(calls.every(call => call.authorization === `Bearer ${token()}`)).toBe(true);
  });

  it("rejects an unauthorized target before resolver or mutation", async () => {
    const calls = mockRpc(Response.json(restored), [{ resume_id: qaResumeId, site_key: "example-cv-qa", role: "qa" }]);
    const response = await handleWorkerRequest(request({ ...mutation, resume_id: officialResumeId }), env());
    expect(response.status).toBe(403);
    expect(calls.map(call => call.url)).toEqual(["https://local.test/rest/v1/rpc/activity_log_authorized_targets"]);
  });

  it("does not bypass Official Restore capability denial", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/rpc/activity_log_authorized_targets")) return Response.json([{ resume_id: officialResumeId, site_key: "example-cv", role: "owner" }]);
      return Response.json({ code: "42501", message: "Restore is disabled for this target" }, { status: 403 });
    }));
    const response = await handleWorkerRequest(request({ ...mutation, resume_id: officialResumeId }), env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "restore_disabled" } });
    expect(calls).toEqual([
      "https://local.test/rest/v1/rpc/activity_log_authorized_targets",
      "https://local.test/rest/v1/rpc/resolve_restore_domain_v1",
    ]);
  });

  it("sanitizes backend stale, capability, and generic failures without exposing raw details", async () => {
    const cases = [
      [{ code: "40001", message: "private stale details" }, 409, "stale_preview"],
      [{ code: "23505", message: "private idempotency details" }, 409, "idempotency_conflict"],
      [{ code: "55000", message: "private pending details" }, 409, "restore_request_pending"],
      [{ code: "42501", message: "Restore is disabled for this target" }, 403, "restore_disabled"],
      [{ code: "XX000", message: "private SQL text" }, 502, "restore_unavailable"],
    ] as const;
    for (const [body, status, code] of cases) {
      mockRpc(Response.json(body, { status: 400 }));
      const response = await handleWorkerRequest(request(mutation), env());
      expect(response.status).toBe(status);
      const result = await response.json();
      expect(result.error.code).toBe(code);
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });

  it("accepts no-change and rejects a malformed mutation result", async () => {
    mockRpc(Response.json({ status: "no_change", domain: "awards", source_event_id: eventId, result_event_id: null }));
    let response = await handleWorkerRequest(request(mutation), env());
    expect(response.status).toBe(200);
    mockRpc(Response.json({ ...restored, actor_user_id: actorId }));
    response = await handleWorkerRequest(request(mutation), env());
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
