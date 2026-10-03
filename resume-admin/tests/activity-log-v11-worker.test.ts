import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker, {
  canonicalizeIntroduction,
  getTrustedNetworkContext,
  handleWorkerRequest,
  normalizeClientNetwork,
  serializePostgresJsonbObject,
  sha256Hex,
  signContext,
  type WorkerEnv,
} from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const requestId = "b1111111-1111-4111-8111-111111111111";
const syntheticKeyHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jwt(sub = actorId): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, role: "authenticated" })}.synthetic-signature`;
}

function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset fallback", { status: 200 })) },
    SUPABASE_URL: "https://synthetic-project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    ACTIVITY_LOG_HMAC_KEY_ID: "local-test-v1",
    ACTIVITY_LOG_HMAC_KEY: syntheticKeyHex,
    ...overrides,
  };
}

function saveRequest(body: unknown, options: { authorization?: string | null; headers?: HeadersInit; method?: string } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.authorization !== null) headers.set("Authorization", options.authorization ?? `Bearer ${jwt()}`);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  const method = options.method ?? "POST";
  return new Request("https://admin.example.test/api/admin/v1/introduction/save", {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    request_id: requestId,
    resume_id: resumeId,
    items: [{ id: null, zh: "  中文🙂  ", en: " English " }],
    ...overrides,
  };
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("Activity Log V1.1 Worker routes and static assets", () => {
  it.each([
    ["/", "GET"],
    ["/login", "GET"],
    ["/admin/profile/deep", "GET"],
    ["/assets/index-example.js", "GET"],
  ])("uses static asset fallback for %s", async (path, method) => {
    const bindings = env();
    const request = new Request(`https://admin.example.test${path}`, { method });
    const response = await worker.fetch(request, bindings);
    expect(await response.text()).toBe("asset fallback");
    expect(bindings.ASSETS.fetch).toHaveBeenCalledWith(request);
  });

  it("routes the exact POST endpoint to the V1.1 handler", async () => {
    const upstream = vi.fn(async () => Response.json([{ id: "persisted" }]));
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(saveRequest(validBody()), env());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "persisted" }]);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("returns JSON 405 for GET to the save endpoint", async () => {
    const response = await handleWorkerRequest(saveRequest(null, { method: "GET" }), env());
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("returns JSON 404 for unknown API paths without invoking SPA assets", async () => {
    const bindings = env();
    const response = await handleWorkerRequest(new Request("https://admin.example.test/api/admin/v1/unknown"), bindings);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });
});

describe("Activity Log V1.1 Worker request validation", () => {
  it("rejects non-JSON and malformed JSON", async () => {
    const noJson = new Request("https://admin.example.test/api/admin/v1/introduction/save", {
      method: "POST", headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "text/plain" }, body: "{}",
    });
    expect((await handleWorkerRequest(noJson, env())).status).toBe(400);
    const malformed = await handleWorkerRequest(saveRequest("{"), env());
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_json" } });
  });

  it("rejects unknown or missing top-level fields and malformed UUIDs", async () => {
    const extra = await handleWorkerRequest(saveRequest(validBody({ unexpected: true })), env());
    expect(extra.status).toBe(400);
    const missing = await handleWorkerRequest(saveRequest({ request_id: requestId, items: [] }), env());
    expect(missing.status).toBe(400);
    const badUuid = await handleWorkerRequest(saveRequest(validBody({ resume_id: "not-a-uuid" })), env());
    expect(badUuid.status).toBe(422);
  });

  it("rejects malformed item shapes, IDs, and duplicate persisted IDs", async () => {
    const malformed = await handleWorkerRequest(saveRequest(validBody({ items: [{ id: null, zh: "x", en: "y", extra: 1 }] })), env());
    expect(malformed.status).toBe(422);
    const badId = await handleWorkerRequest(saveRequest(validBody({ items: [{ id: "local-bad", zh: "x", en: "y" }] })), env());
    expect(badId.status).toBe(422);
    const duplicateId = "ea000000-0000-4000-8000-000000000006";
    const duplicate = await handleWorkerRequest(saveRequest(validBody({ items: [
      { id: duplicateId, zh: "a", en: "a" }, { id: duplicateId, zh: "b", en: "b" },
    ] })), env());
    expect(duplicate.status).toBe(422);
  });

  it("rejects excessive item counts, invalid text, and unpaired surrogate content", async () => {
    const tooMany = await handleWorkerRequest(saveRequest(validBody({ items: Array.from({ length: 201 }, () => ({ id: null, zh: "x", en: "y" })) })), env());
    expect(tooMany.status).toBe(422);
    const tooLong = await handleWorkerRequest(saveRequest(validBody({ items: [{ id: null, zh: "x".repeat(12_001), en: "" }] })), env());
    expect(tooLong.status).toBe(422);
    const surrogate = await handleWorkerRequest(saveRequest({ request_id: requestId, resume_id: resumeId, items: [{ id: null, zh: "\ud800", en: "" }] }), env());
    expect(surrogate.status).toBe(422);
  });

  it.each([
    ["zh", "中文\0内容"],
    ["en", "English\0content"],
  ])("rejects U+0000 in %s before signing or upstream fetch", async (locale, text) => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(saveRequest(validBody({
      items: [{ id: null, zh: locale === "zh" ? text : "safe", en: locale === "en" ? text : "safe" }],
    })), env());
    const body = await response.text();
    expect(response.status).toBe(422);
    expect(body).not.toContain("content");
    expect(body).not.toContain("中文");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("enforces actual 512 KiB request bytes when Content-Length is absent or understated", async () => {
    const large = "x".repeat(512 * 1024 + 1);
    for (const contentLength of [undefined, "1"]) {
      const headers = new Headers({ Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" });
      if (contentLength !== undefined) headers.set("Content-Length", contentLength);
      const request = new Request("https://admin.example.test/api/admin/v1/introduction/save", {
        method: "POST", headers, body: large,
      });
      const response = await handleWorkerRequest(request, env());
      expect(response.status).toBe(413);
    }
  });

  it("does not reject a request solely because its HTTP body is exactly 512 KiB", async () => {
    const upstream = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", upstream);
    const compact = JSON.stringify(validBody({ items: [] }));
    const compactBytes = new TextEncoder().encode(compact).byteLength;
    const exactBody = compact + " ".repeat(512 * 1024 - compactBytes);
    expect(new TextEncoder().encode(exactBody).byteLength).toBe(512 * 1024);
    const response = await handleWorkerRequest(saveRequest(exactBody), env());
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects an excessive declared Content-Length before reading the request body", async () => {
    const request = new Request("https://admin.example.test/api/admin/v1/introduction/save", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json", "Content-Length": String(512 * 1024 + 1) },
      body: "{}",
    });
    const response = await handleWorkerRequest(request, env());
    expect(response.status).toBe(413);
  });

  it("rejects canonical UTF-8 payloads over 256 KiB even when the request is within 512 KiB", async () => {
    const items = Array.from({ length: 9 }, () => ({ id: null, zh: "中".repeat(10_000), en: "" }));
    const body = validBody({ items });
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThan(512 * 1024);
    const response = await handleWorkerRequest(saveRequest(body), env());
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "canonical_payload_too_large" } });
  });
});

describe("Activity Log V1.1 Worker authentication and trusted network context", () => {
  it.each([
    [null, "missing"],
    ["Basic dXNlcg==", "wrong scheme"],
    ["Bearer not-a-jwt", "malformed JWT"],
    [`Bearer ${jwt("")}`, "missing sub"],
    [`Bearer ${jwt("not-a-uuid")}`, "invalid sub"],
  ])("rejects %s authorization (%s)", async (authorization, _caseName) => {
    expect(_caseName).toBeTruthy();
    const response = await handleWorkerRequest(saveRequest(validBody(), { authorization }), env());
    expect(response.status).toBe(401);
  });

  it("forwards the original Bearer token and publishable apikey to only the V1.1 RPC", async () => {
    const originalToken = `Bearer ${jwt()}`;
    const upstream = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(saveRequest(validBody(), { authorization: originalToken }), env());
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://synthetic-project.supabase.co/rest/v1/rpc/save_resume_introduction_v11");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(originalToken);
    expect(headers.get("apikey")).toBe("sb_publishable_synthetic");
    const rpcBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(rpcBody)).toEqual(["target_resume_id", "canonical_items", "signed_context", "signature_hex"]);
    expect(rpcBody.target_resume_id).toBe(resumeId);
    expect(upstream.mock.calls).toHaveLength(1);
  });

  it("uses CF-Connecting-IP and request.cf metadata, ignoring X-Forwarded-For and browser geo fields", () => {
    const request = new Request("https://admin.example.test/api/admin/v1/introduction/save", {
      headers: { "CF-Connecting-IP": "198.51.100.73", "X-Forwarded-For": "203.0.113.99", "X-Country": "FR" },
    }) as Request & { cf?: Record<string, unknown> };
    request.cf = { country: "us", region: "Region", city: "City", latitude: 10, longitude: 20 };
    expect(getTrustedNetworkContext(request)).toEqual({
      ip_network: "198.51.100.0/24", country_code: "US", region: "Region", city: "City",
    });
  });

  it("normalizes IPv4 and IPv6 networks and maps malformed or unavailable IP to null", () => {
    expect(normalizeClientNetwork("203.0.113.45")).toBe("203.0.113.0/24");
    expect(normalizeClientNetwork("2001:db8:abcd:1234::1")).toBe("2001:db8:abcd::/48");
    expect(normalizeClientNetwork("2001:db8::192.0.2.1")).toBe("2001:db8::/48");
    expect(normalizeClientNetwork("999.1.1.1")).toBeNull();
    expect(normalizeClientNetwork("1.2.3")).toBeNull();
    expect(normalizeClientNetwork("1.2.3.4:1234")).toBeNull();
    expect(normalizeClientNetwork("203.0.113.1,198.51.100.2")).toBeNull();
    expect(normalizeClientNetwork(" 1.2.3.4")).toBeNull();
    expect(normalizeClientNetwork("01.02.03.04")).toBeNull();
    expect(normalizeClientNetwork("1.2.3.04")).toBeNull();
    expect(normalizeClientNetwork("255.255.255.255")).toBe("255.255.255.0/24");
    expect(normalizeClientNetwork("0.0.0.0")).toBe("0.0.0.0/24");
    expect(normalizeClientNetwork("not-an-ip")).toBeNull();
    expect(normalizeClientNetwork(null)).toBeNull();
  });

  it("turns invalid optional network metadata into null", () => {
    const request = new Request("https://admin.example.test/api/admin/v1/introduction/save", {
      headers: { "CF-Connecting-IP": "invalid", "X-Forwarded-For": "198.51.100.5" },
    }) as Request & { cf?: Record<string, unknown> };
    request.cf = { country: "usa", region: `bad${String.fromCharCode(1)}`, city: "x".repeat(129) };
    expect(getTrustedNetworkContext(request)).toEqual({ ip_network: null, country_code: null, region: null, city: null });
    expect(getTrustedNetworkContext(new Request("https://admin.example.test"))).toEqual({
      ip_network: null, country_code: null, region: null, city: null,
    });
  });

  it("maps C0, DEL, C1, and oversized geo metadata to null while preserving valid Unicode", () => {
    const request = (region: unknown, city: unknown) => {
      const value = new Request("https://admin.example.test") as Request & { cf?: Record<string, unknown> };
      value.cf = { region, city };
      return getTrustedNetworkContext(value);
    };
    expect(request(`Region${String.fromCharCode(1)}`, "City").region).toBeNull();
    expect(request("Region\u007f", "City").region).toBeNull();
    expect(request("Region\u0085", "City").region).toBeNull();
    expect(request("München 東京", "城市🙂").region).toBe("München 東京");
    expect(request("é".repeat(64), "City").region).toBe("é".repeat(64));
    expect(request("é".repeat(65), "City").region).toBeNull();
  });
});

describe("Activity Log V1.1 Worker canonicalization and PostgreSQL signing contract", () => {
  it("canonicalizes only fixed fields in submitted order, preserving Unicode, whitespace, and null versus empty", async () => {
    const items = [
      { id: null, zh: "  中文🙂  ", en: "" },
      { id: "local-1-2", zh: "second\nline", en: " EN " },
    ];
    const canonical = canonicalizeIntroduction(items);
    expect(canonical).toBe('[{"id":null,"zh":"  中文🙂  ","en":""},{"id":"local-1-2","zh":"second\\nline","en":" EN "}]');
    expect(await sha256Hex(canonical)).toBe(await sha256Hex(canonical));
    expect(await sha256Hex(canonical)).not.toBe(await sha256Hex(canonicalizeIntroduction([...items].reverse())));
  });

  it("matches a deterministic Worker/PostgreSQL signer contract vector", async () => {
    // Values and expected bytes/signature were obtained from the frozen 20261005
    // contract's test_only_sign_activity_log_v11_context PostgreSQL helper.
    const canonical = '[{"id":null,"zh":"中文 A","en":"English"}]';
    const digest = await sha256Hex(canonical);
    const context = {
      context_version: 1,
      key_id: "local-test-v1",
      actor_user_id: actorId,
      resume_id: resumeId,
      domain: "introduction" as const,
      operation: "update" as const,
      request_id: requestId,
      mutation_digest: digest,
      issued_at: 1_790_000_000,
      expires_at: 1_790_000_180,
      ip_network: "203.0.113.0/24",
      country_code: "US",
      region: "Test Region",
      city: "Test City",
    };
    const signed = await signContext(context, Uint8Array.from(syntheticKeyHex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16))));
    expect(digest).toBe("a574834cd845c1402d62c16ce80c5f1d1cd7774e604b7b0728a470bd5790e857");
    expect(signed.serialized).toBe('{"city": "Test City", "domain": "introduction", "key_id": "local-test-v1", "region": "Test Region", "issued_at": 1790000000, "operation": "update", "resume_id": "ea111111-1111-4111-8111-111111111111", "expires_at": 1790000180, "ip_network": "203.0.113.0/24", "request_id": "b1111111-1111-4111-8111-111111111111", "country_code": "US", "actor_user_id": "10000000-0000-4000-8000-000000000002", "context_version": 1, "mutation_digest": "a574834cd845c1402d62c16ce80c5f1d1cd7774e604b7b0728a470bd5790e857"}');
    expect(signed.signatureHex).toBe("f921816a44e63249cab36a7c305bb89f5fe33fe3e105c0783491751853e4b503");
    expect(serializePostgresJsonbObject(context)).toBe(signed.serialized);
  });

  it("retries the same request and mutation with a fresh signed context", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBeTruthy();
      expect(init?.method).toBe("POST");
      return Response.json([]);
    });
    vi.stubGlobal("fetch", upstream);
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_790_000_000_000)
      .mockReturnValueOnce(1_790_000_001_000);
    const body = validBody({ items: [{ id: null, zh: "稳定内容", en: "Stable content" }] });
    const firstResponse = await handleWorkerRequest(saveRequest(body), env());
    const secondResponse = await handleWorkerRequest(saveRequest(body), env());
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);

    const rpcBodies = upstream.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, string>);
    expect(rpcBodies[0].target_resume_id).toBe(resumeId);
    const contexts = rpcBodies.map((rpcBody) => JSON.parse(rpcBody.signed_context) as Record<string, unknown>);
    expect(contexts[0].request_id).toBe(requestId);
    expect(contexts[1].request_id).toBe(requestId);
    expect(rpcBodies[0].canonical_items).toBe(rpcBodies[1].canonical_items);
    expect(contexts[0].mutation_digest).toBe(contexts[1].mutation_digest);
    expect(contexts[0].issued_at).not.toBe(contexts[1].issued_at);
    expect(contexts[0].expires_at).not.toBe(contexts[1].expires_at);
    expect(rpcBodies[0].signed_context).not.toBe(rpcBodies[1].signed_context);
    expect(rpcBodies[0].signature_hex).not.toBe(rpcBodies[1].signature_hex);
  });
});

describe("Activity Log V1.1 Worker upstream failures and configuration", () => {
  it("accepts HTTPS Supabase configuration and rejects insecure or malformed URLs before fetch", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBeTruthy();
      expect(init?.method).toBe("POST");
      return Response.json([]);
    });
    vi.stubGlobal("fetch", upstream);
    const accepted = await handleWorkerRequest(saveRequest(validBody()), env({ SUPABASE_URL: "https://synthetic-project.supabase.co" }));
    expect(accepted.status).toBe(200);
    expect(String(upstream.mock.calls[0]?.[0])).toBe("https://synthetic-project.supabase.co/rest/v1/rpc/save_resume_introduction_v11");

    upstream.mockClear();
    for (const url of ["http://synthetic-project.supabase.co", "https:/synthetic-project.supabase.co", "not a URL", "ftp://synthetic-project.supabase.co"]) {
      const response = await handleWorkerRequest(saveRequest(validBody()), env({ SUPABASE_URL: url }));
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain(url);
      expect(text).not.toContain(jwt());
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not call Supabase when key or public project configuration is missing", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    for (const bindings of [env({ ACTIVITY_LOG_HMAC_KEY: undefined }), env({ SUPABASE_PUBLISHABLE_KEY: undefined })]) {
      const response = await handleWorkerRequest(saveRequest(validBody()), bindings);
      expect(response.status).toBe(503);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("sanitizes upstream errors and never falls back to the legacy RPC", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("save_resume_introduction_v11");
      expect(init?.method).toBe("POST");
      return Response.json({ code: "42501", message: "secret SQL and Introduction contents" }, { status: 400 });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(saveRequest(validBody()), env());
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).not.toContain("secret SQL");
    expect(text).not.toContain("Introduction contents");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0]?.[0])).toContain("save_resume_introduction_v11");
  });

  it("sanitizes malformed and oversized upstream responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>private failure</html>", { status: 200 })));
    const malformed = await handleWorkerRequest(saveRequest(validBody()), env());
    expect(malformed.status).toBe(502);
    expect(await malformed.text()).not.toContain("private failure");
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(512 * 1024 + 1), { status: 200 })));
    const oversized = await handleWorkerRequest(saveRequest(validBody()), env());
    expect(oversized.status).toBe(502);
    expect(await oversized.text()).not.toContain("x".repeat(100));
  });

  it("maps only recognized idempotency conflict and expiry errors to 409", async () => {
    for (const [code, message, expected] of [
      ["23505", "Idempotency key conflicts with a different request", "idempotency_conflict"],
      ["22023", "Idempotency request has expired; use a new request ID", "idempotency_expired"],
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code, message }, { status: 400 })));
      const response = await handleWorkerRequest(saveRequest(validBody()), env());
      expect(response.status).toBe(409);
      expect(await responseBody(response)).toMatchObject({ error: { code: expected } });
      vi.unstubAllGlobals();
    }
  });

  it("returns a sanitized bounded-timeout response", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("private endpoint details", "TimeoutError");
    });
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(saveRequest(validBody()), env());
    expect(response.status).toBe(504);
    expect(await response.text()).not.toContain("private endpoint details");
  });

  it("does not place service-role credentials or logging of request secrets in the Worker", async () => {
    const source = readFileSync(resolve("src/worker/index.ts"), "utf8");
    expect(source).not.toMatch(/service[_-]?role/i);
    expect(source).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/);
  });
});
