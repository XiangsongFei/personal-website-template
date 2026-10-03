import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const qaResume = "ea111111-1111-4111-8111-111111111111";
const officialResume = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const requestId = "bbbbbbbb-0000-4000-8000-000000000903";
const v11Key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const v13TestKey = "a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jwt(sub = actorId): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, role: "authenticated" })}.synthetic-signature`;
}

function environment(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    SUPABASE_URL: "https://synthetic-project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1",
    ACTIVITY_LOG_HMAC_KEY: v11Key,
    ACTIVITY_LOG_V13_HMAC_KEY: v13TestKey,
    ACTIVITY_LOG_V13B_FAILURE_REPORTING: "true",
    ...overrides,
  };
}

function request(resumeId = qaResume): Request {
  return new Request("https://admin.example.test/api/admin/v1/introduction/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt()}`,
      "CF-Connecting-IP": "188.253.112.72",
    },
    body: JSON.stringify({
      request_id: requestId,
      resume_id: resumeId,
      items: [{ id: null, zh: "synthetic QA content", en: "synthetic QA content" }],
    }),
  });
}

function postgrestFailure(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(mutationResponse: Response | (() => Promise<Response>), recorderResponse: Response | (() => Promise<Response>) = Response.json({ event_id: "recorded", recorded: true })) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    calls.push({ url: url.toString(), init });
    if (url.pathname.endsWith("/save_resume_introduction_v11")) {
      return typeof mutationResponse === "function" ? mutationResponse() : mutationResponse.clone();
    }
    if (url.pathname.endsWith("/record_activity_log_system_failure")) {
      return typeof recorderResponse === "function" ? recorderResponse() : recorderResponse.clone();
    }
    throw new Error("Unexpected Worker test fetch path");
  }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  return calls;
}

async function invoke(resumeId = qaResume, env = environment()): Promise<Response> {
  return handleWorkerRequest(request(resumeId), env);
}

describe("V1.3B classification and reporter isolation", () => {
  it("classifies only HTTP 400 with exact P13B1 code; message text is irrelevant", async () => {
    const calls = installFetch(postgrestFailure(400, { code: "P13B1", message: "localized or changed wording" }));
    const response = await invoke();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "idempotency_conflict", message: "This save request conflicts with an earlier request." } });
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(1);
  });

  it.each([
    [400, "23505", "Idempotency key conflicts with a different request"],
    [400, "22023", "anything"],
    [400, "42501", "anything"],
    [400, "P13B2", "anything"],
    [500, "P13B1", "not a deterministic rejection"],
  ])("does not report status %s with non-allowlisted SQLSTATE %s", async (status, code, message) => {
    const calls = installFetch(postgrestFailure(status, { code, message }));
    await invoke();
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(0);
  });

  it("does not report a malformed PostgREST response", async () => {
    const calls = installFetch(postgrestFailure(400, "not-json"));
    const response = await invoke();
    expect(response.status).toBe(502);
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(0);
  });

  it("does not report when the mutation call has a network failure", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("offline"); });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await invoke();
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not report when the mutation call times out", async () => {
    const fetchMock = vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await invoke();
    expect(response.status).toBe(504);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["reporting switch is absent", { ACTIVITY_LOG_V13B_FAILURE_REPORTING: undefined }],
    ["reporting switch is false", { ACTIVITY_LOG_V13B_FAILURE_REPORTING: "false" }],
    ["V1.3 key is absent", { ACTIVITY_LOG_V13_HMAC_KEY: undefined }],
  ])("preserves the conflict while off or unconfigured: %s", async (_case, envOverride) => {
    const calls = installFetch(postgrestFailure(400, { code: "P13B1", message: "irrelevant" }));
    const response = await invoke(qaResume, environment(envOverride));
    expect(response.status).toBe(409);
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(0);
  });

  it("hard-blocks the Official target even if P13B1 is returned and reporting is enabled", async () => {
    const calls = installFetch(postgrestFailure(400, { code: "P13B1", message: "irrelevant" }));
    const response = await invoke(officialResume);
    expect(response.status).toBe(409);
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(0);
  });
});

describe("V1.3B recorder request and best-effort retry", () => {
  it("forwards the original bearer and bounded event fields without service_role or business payload", async () => {
    const calls = installFetch(postgrestFailure(400, { code: "P13B1", message: "ignored" }));
    await invoke();
    const recorder = calls.find((call) => call.url.endsWith("/record_activity_log_system_failure"));
    expect(recorder).toBeDefined();
    expect(new Headers(recorder?.init?.headers).get("Authorization")).toBe(`Bearer ${jwt()}`);
    expect(new Headers(recorder?.init?.headers).get("apikey")).toBe("sb_publishable_synthetic");
    expect(JSON.stringify(recorder?.init?.headers)).not.toContain("service_role");
    const payload = JSON.parse(String(recorder?.init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      target_resume_id: qaResume,
      target_request_id: requestId,
      target_actor_user_id: actorId,
      target_protocol_version: 1,
      target_purpose: "activity_log_system_event_v13",
      target_key_id: "activity_log_v13_failure_v1",
      target_event_kind: "operation_failure",
      target_outcome: "rejected",
      target_section_key: "introduction",
      target_operation: "update",
      target_failure_stage: "idempotency",
      target_failure_code: "idempotency_conflict",
      target_ip_network: "188.253.112.0/24",
    });
    expect(payload.target_event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(payload).not.toHaveProperty("items");
    expect(payload).not.toHaveProperty("canonical_items");
    expect(payload).not.toHaveProperty("target_signature");
    expect(String(recorder?.init?.body)).not.toContain("synthetic QA content");
    expect(String(recorder?.init?.body)).not.toContain(jwt());
  });

  it("retries a recorder 5xx at most once with the exact same envelope and preserves the original conflict", async () => {
    const bodies: string[] = [];
    const calls = installFetch(
      postgrestFailure(400, { code: "P13B1", message: "changed upstream wording" }),
      async () => {
        const recorderCall = calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure")).at(-1);
        bodies.push(String(recorderCall?.init?.body));
        return bodies.length === 1 ? postgrestFailure(503, { code: "temporary" }) : Response.json({ recorded: false });
      },
    );
    const response = await invoke();
    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("idempotency_conflict");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(2);
  });

  it.each([
    [401, "recorder_unauthorized", 1],
    [403, "recorder_rejected", 1],
    [503, "recorder_upstream_failure", 2],
  ])("keeps the save rejected when recorder returns %s", async (status, expectedLog, expectedCalls) => {
    const calls = installFetch(
      postgrestFailure(400, { code: "P13B1", message: "ignored" }),
      postgrestFailure(status, { code: "sanitized" }),
    );
    const response = await invoke();
    expect(response.status).toBe(409);
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(expectedCalls);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith("activity_log_v13_reporter", expectedLog);
  });

  it("keeps the save rejected after recorder timeout without unbounded retry", async () => {
    const calls = installFetch(postgrestFailure(400, { code: "P13B1", message: "ignored" }), async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    const response = await invoke();
    expect(response.status).toBe(409);
    expect(calls.filter((call) => call.url.endsWith("/record_activity_log_system_failure"))).toHaveLength(2);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith("activity_log_v13_reporter", "recorder_timeout");
  });
});
