import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const uploadId = "d1111111-1111-4111-8111-111111111111";
const filename = "private-name-resume.pdf";
const bytes = new TextEncoder().encode("%PDF-1.7 private fixture bytes");
const auth = `Bearer ${btoa(JSON.stringify({ alg: "HS256" })).replaceAll("=", "")}.${btoa(JSON.stringify({ sub: actorId, role: "authenticated" })).replaceAll("=", "")}.synthetic-token`;

function env(diagnostics?: string): WorkerEnv {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    SUPABASE_URL: "https://local.test",
    SUPABASE_PUBLISHABLE_KEY: "publishable-secret-fixture",
    ACTIVITY_LOG_HMAC_KEY_ID: "activity_log_v11_hmac_v1",
    ACTIVITY_LOG_HMAC_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    D8_FILES_UPLOAD_DIAGNOSTICS: diagnostics,
  };
}

function uploadRequest(options: { url?: string; authorization?: string; body?: BodyInit; headers?: Record<string, string> } = {}) {
  return new Request(options.url ?? "https://qa.test/api/admin/v1/files/upload?locale=zh", {
    method: "POST",
    headers: {
      Authorization: options.authorization ?? auth,
      "Content-Type": "application/pdf",
      "X-Upload-Request-ID": uploadId,
      "X-Original-Filename": filename,
      Cookie: "session=private-cookie-fixture",
      ...options.headers,
    },
    body: options.body ?? new Uint8Array(bytes),
  });
}

function diagnosticRecords(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls.flatMap(call => call[0] === "d8_files_upload"
    ? [call[1] as Record<string, unknown>]
    : []);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QA-only Files upload diagnostics", () => {
  it("emits no stage logs when the explicit diagnostic gate is absent or disabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "42501" }, { status: 403 })));
    for (const setting of [undefined, "false", "TRUE"]) {
      const response = await handleWorkerRequest(uploadRequest(), env(setting));
      expect(response.status).toBe(403);
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("emits the successful route-to-prepare sequence with a redacted safe payload", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let candidate = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if (url.endsWith("/rpc/prepare_resume_file_upload_v1")) {
        candidate = `${resumeId}/zh/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
        return Response.json([{ object_name: candidate, upload_status: "prepared" }]);
      }
      if (url === `https://local.test/storage/v1/object/resume-files/${candidate}`) return Response.json({ Key: candidate });
      if (url === `https://local.test/storage/v1/object/authenticated/resume-files/${candidate}`) return new Response(bytes, { status: 200 });
      if (url.endsWith("/rpc/complete_resume_file_upload_v1")) return Response.json(true);
      return new Response("unexpected-upstream-body-fixture", { status: 404 });
    }));

    const response = await handleWorkerRequest(uploadRequest(), env("true"));
    expect(response.status).toBe(200);
    const records = diagnosticRecords(log);
    expect(records.map(record => record.stage)).toEqual([
      "upload_route_entered",
      "body_read_started",
      "body_read_completed",
      "request_validation_completed",
      "target_resolution_started",
      "target_resolution_succeeded",
      "prepare_intent_rpc_started",
      "prepare_intent_rpc_succeeded",
      "response_status_prepared",
      "handler_completed",
    ]);
    expect(records.every(record => record.request_id === uploadId && record.locale === "zh")).toBe(true);
    expect(records[2]).toMatchObject({ byte_count: bytes.byteLength });
    const serialized = JSON.stringify(records);
    for (const secret of [auth, filename, new TextDecoder().decode(bytes), "private-cookie-fixture", "publishable-secret-fixture", "unexpected-upstream-body-fixture"])
      expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("ACTIVITY_LOG_HMAC_KEY");
    expect(serialized).not.toContain("content_sha256");
  });

  it("marks body-read failure without logging the thrown body error", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("private-body-read-error-fixture")); },
    });
    const request = new Request("https://qa.test/api/admin/v1/files/upload?locale=zh", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/pdf", "X-Upload-Request-ID": uploadId, "X-Original-Filename": filename },
      body,
      duplex: "half",
    } as RequestInit);

    const response = await handleWorkerRequest(request, env("true"));
    expect(response.status).toBe(502);
    const records = diagnosticRecords(log);
    expect(records.map(record => record.stage)).toEqual([
      "upload_route_entered", "body_read_started", "body_read_failed", "response_status_prepared", "handler_completed",
    ]);
    expect(records[2]).toMatchObject({ status: 502, code: "body_read_failed" });
    expect(JSON.stringify(records)).not.toContain("private-body-read-error-fixture");
  });

  it("marks validation rejection without logging rejected query/header values", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await handleWorkerRequest(uploadRequest({
      url: "https://qa.test/api/admin/v1/files/upload?locale=zh&private_query=do-not-log",
      headers: { "X-Original-Filename": "do-not-log-filename.pdf" },
    }), env("true"));
    expect(response.status).toBe(400);
    const records = diagnosticRecords(log);
    expect(records.map(record => record.stage)).toEqual([
      "upload_route_entered", "request_validation_rejected", "response_status_prepared", "handler_completed",
    ]);
    expect(records[1]).toMatchObject({ status: 400, code: "invalid_upload_request" });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("do-not-log");
    expect(serialized).not.toContain("private_query");
  });

  it("does not log a malformed raw upload request ID and preserves validation response semantics", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const invalidRequestId = "NOT-A-UUID-8Z-RAW-ID-DO-NOT-LOG-7f91!";
    const response = await handleWorkerRequest(uploadRequest({
      headers: { "X-Upload-Request-ID": invalidRequestId },
    }), env("true"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_upload_request", message: "A supported locale and upload request UUID are required." },
    });
    expect(fetch).not.toHaveBeenCalled();
    const records = diagnosticRecords(log);
    expect(records.map(record => record.stage)).toEqual([
      "upload_route_entered", "request_validation_rejected", "response_status_prepared", "handler_completed",
    ]);
    expect(records[1]).toMatchObject({ status: 400, code: "invalid_upload_request" });
    expect(records.every(record => !Object.hasOwn(record, "request_id"))).toBe(true);
    const serialized = JSON.stringify(records);
    for (const prohibited of [invalidRequestId, auth, filename, "private-cookie-fixture", new TextDecoder().decode(bytes)])
      expect(serialized).not.toContain(prohibited);
  });

  it("derives ordered elapsed durations from the monotonic clock, never Date.now", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const times = [100, 100.5, 101.25, 102, 102.75];
    vi.spyOn(performance, "now").mockImplementation(() => {
      const value = times.shift();
      if (value === undefined) throw new Error("unexpected monotonic clock read");
      return value;
    });
    const request = uploadRequest({
      url: "https://qa.test/api/admin/v1/files/upload?locale=zh&private_query=timing-fixture",
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("wall clock must not be used for diagnostic elapsed time");
    });

    const response = await handleWorkerRequest(request, env("true"));
    expect(response.status).toBe(400);
    const elapsed = diagnosticRecords(log).map(record => record.elapsed_ms);
    expect(elapsed).toEqual([0.5, 1.25, 2, 2.75]);
    expect(elapsed.every(value => typeof value === "number" && value >= 0)).toBe(true);
    expect(elapsed).toEqual([...elapsed].sort((left, right) => Number(left) - Number(right)));
    expect(times).toHaveLength(0);
  });

  it("distinguishes auth/target-resolution failure from prepare failure", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const unauthorized = await handleWorkerRequest(uploadRequest({ authorization: "not-a-bearer-token" }), env("true"));
    expect(unauthorized.status).toBe(401);
    expect(diagnosticRecords(log).map(record => record.stage)).toContain("target_resolution_failed");
    expect(JSON.stringify(diagnosticRecords(log))).not.toContain("not-a-bearer-token");

    log.mockClear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if (url.endsWith("/rpc/prepare_resume_file_upload_v1"))
        return Response.json({ code: "private-raw-upstream-body", detail: "do-not-log-upstream-detail" }, { status: 400 });
      return new Response("unexpected", { status: 404 });
    }));
    const failed = await handleWorkerRequest(uploadRequest(), env("true"));
    expect(failed.status).toBe(422);
    const records = diagnosticRecords(log);
    expect(records.map(record => record.stage)).toContain("prepare_intent_rpc_started");
    expect(records.map(record => record.stage)).toContain("prepare_intent_rpc_failed");
    expect(records.find(record => record.stage === "prepare_intent_rpc_failed")).toMatchObject({ status: 400, code: "prepare_rejected" });
    expect(records.at(-2)).toMatchObject({ status: 422, code: "upload_not_authorized" });
    expect(JSON.stringify(records)).not.toContain("private-raw-upstream-body");
    expect(JSON.stringify(records)).not.toContain("do-not-log-upstream-detail");
  });
});
