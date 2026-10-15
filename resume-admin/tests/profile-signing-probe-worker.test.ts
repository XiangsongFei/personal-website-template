import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const actorId = "f6000000-0000-4000-8000-000000000002";
const testKeyHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const domain = "example-cv:test-profile-signing-probe:v1\n";
const probePath = "https://admin.example.test/api/admin/v1/profile/signing-probe";

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
    ASSETS: { fetch: vi.fn(async () => new Response("asset fallback")) },
    SUPABASE_URL: "https://synthetic-project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1",
    ACTIVITY_LOG_HMAC_KEY: testKeyHex,
    ...overrides,
  };
}

function request(options: { authorization?: string | null; method?: string; body?: string; url?: string } = {}): Request {
  const headers = new Headers();
  if (options.authorization !== null) headers.set("Authorization", options.authorization ?? `Bearer ${jwt()}`);
  return new Request(options.url ?? probePath, {
    method: options.method ?? "POST",
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

function verifiedRpc(expectedKeyHex: string) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://synthetic-project.supabase.co/rest/v1/rpc/verify_test_profile_signing_probe_v1");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as { signed_context: string; signature_hex: string };
    const expected = createHmac("sha256", Buffer.from(expectedKeyHex, "hex"))
      .update(domain + body.signed_context, "utf8").digest("hex");
    return Response.json(body.signature_hex === expected);
  });
}

async function result(response: Response) {
  return await response.json() as { result: string; [key: string]: unknown };
}

describe("Test Profile signing compatibility probe", () => {
  it("returns PASS for a matching disposable key and sends only a server-generated fixed-target challenge", async () => {
    const upstream = verifiedRpc(testKeyHex);
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(), env());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await result(response)).toEqual({ result: "PASS" });
    expect(upstream).toHaveBeenCalledOnce();
    const [, init] = upstream.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${jwt()}`);
    expect(headers.get("apikey")).toBe("sb_publishable_synthetic");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["signature_hex", "signed_context"]);
    const context = JSON.parse(String(body.signed_context)) as Record<string, unknown>;
    expect(context).toMatchObject({
      context_version: 1,
      purpose: "test_profile_signing_probe_v1",
      key_id: "activity_log_v11_hmac_v1",
      actor_user_id: actorId,
      resume_id: "f6000000-0000-4000-8000-000000000001",
    });
    expect(context.nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number(context.expires_at) - Number(context.issued_at)).toBe(30);
    expect(String(body.signature_hex)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify({ result: "PASS" })).not.toMatch(/[0-9a-f]{64}/);
  });

  it("returns FAIL when the disposable Worker key differs from the expected Vault key", async () => {
    const upstream = verifiedRpc(testKeyHex);
    vi.stubGlobal("fetch", upstream);
    const differentKey = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const response = await handleWorkerRequest(request(), env({ ACTIVITY_LOG_HMAC_KEY: differentKey }));
    expect(await result(response)).toEqual({ result: "FAIL" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong key ID", { ACTIVITY_LOG_HMAC_KEY_ID: "another-key" }],
    ["missing key ID", { ACTIVITY_LOG_HMAC_KEY_ID: undefined }],
    ["short encoding", { ACTIVITY_LOG_HMAC_KEY: testKeyHex.slice(2) }],
    ["uppercase encoding", { ACTIVITY_LOG_HMAC_KEY: testKeyHex.toUpperCase() }],
    ["non-hex encoding", { ACTIVITY_LOG_HMAC_KEY: `${testKeyHex.slice(0, 62)}zz` }],
  ])("fails closed for %s without calling Supabase", async (_label, overrides) => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(), env(overrides));
    expect(response.status).toBe(200);
    expect(await result(response)).toEqual({ result: "FAIL" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("normalizes RPC denial, invalid responses, and network failures to the same result", async () => {
    for (const fetchMock of [
      vi.fn(async () => new Response("internal details", { status: 403 })),
      vi.fn(async () => new Response("not-json", { status: 200 })),
      vi.fn(async () => { throw new Error("private transport detail"); }),
    ]) {
      vi.stubGlobal("fetch", fetchMock);
      const response = await handleWorkerRequest(request(), env());
      expect(response.status).toBe(200);
      const responseText = await response.text();
      expect(JSON.parse(responseText)).toEqual({ result: "FAIL" });
      expect(responseText).not.toMatch(/internal details|private transport/);
    }
  });

  it.each([
    ["missing authentication", { authorization: null }],
    ["malformed authentication", { authorization: "Bearer malformed" }],
    ["request body", { body: "{}" }],
    ["query parameters", { url: `${probePath}?target=f6000000-0000-4000-8000-000000000001` }],
    ["wrong method", { method: "GET" }],
  ])("returns only generic FAIL for %s", async (_label, requestOptions) => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await handleWorkerRequest(request(requestOptions), env());
    expect(response.status).toBe(200);
    expect(await result(response)).toEqual({ result: "FAIL" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not log probe request or signing details", async () => {
    const log = vi.spyOn(console, "log");
    const info = vi.spyOn(console, "info");
    const upstream = verifiedRpc(testKeyHex);
    vi.stubGlobal("fetch", upstream);
    await handleWorkerRequest(request(), env());
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
