import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const otherResumeId = "10000000-0000-4000-8000-000000000001";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const timestamp = "2026-10-05T02:10:04.438175+00:00";
const objectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const baseUrl = "https://project.supabase.co";
const apiUrl = "https://qa-admin.test/api/admin/v1/version-history/profile-image";
const photoUrl = `${baseUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/${objectId}.png`;
const bytes = new Uint8Array([137, 80, 78, 71]);

function token() {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "10000000-0000-4000-8000-000000000002", role: "authenticated" })}.synthetic`;
}

function env(): WorkerEnv {
  return { ASSETS: { fetch: async () => new Response("asset") }, SUPABASE_URL: baseUrl, SUPABASE_PUBLISHABLE_KEY: "public-test-key" };
}

function request(body: unknown, authenticated = true) {
  return new Request(apiUrl, { method: "POST", headers: {
    "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token()}` } : {}),
  }, body: JSON.stringify(body) });
}

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    occurred_at: timestamp,
    actor_account_label: "QA account",
    actor_role: "qa",
    domain_key: "profile",
    operation: "update",
    payload_version: 2,
    entity_type: "profile_settings",
    entity_id: null,
    comparison_kind: "aggregate",
    comparison: {
      before: { shared: { photo_url: null } },
      after: { shared: { photo_url: photoUrl } },
    },
    has_more: false,
    ...overrides,
  };
}

function fullProfile(photo: string | null) {
  const translations = Object.fromEntries(["zh", "en"].map(locale => [locale, {
    name: "Name", nav_about_label: "About", email_action_label: "Email", graduation_label: "Graduation",
    avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status",
  }]));
  return { shared: { graduation_value: "2020", avatar_initials: "N", footer_name: "Name", copyright: "Copyright", photo_url: photo }, translations };
}

function rpcV2(overrides: Record<string, unknown> = {}) {
  return rpcRow({ comparison: { before: fullProfile(null), after: fullProfile(photoUrl) }, ...overrides });
}

function rpcV1(objectKey: unknown, overrides: Record<string, unknown> = {}) {
  const change = objectKey;
  return rpcRow({ payload_version: 1, entity_type: "profile_image", comparison_kind: "entity_fields", entity_id: null,
    comparison: { changes: { object_key: change } }, ...overrides });
}

function installFetch(row: unknown = rpcV2(), storage: Response | (() => Response) = new Response(bytes, { headers: { "Content-Type": "image/png" } })) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/rpc/read_version_history_v1")) return row instanceof Response ? row : Response.json([row]);
    return typeof storage === "function" ? storage() : storage;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const validBody = (overrides: Record<string, unknown> = {}) => ({ resume_id: resumeId, event_id: eventId, occurred_at: timestamp, side: "after", ...overrides });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("authenticated Profile history image resolver", () => {
  it.each([
    ["JPEG", "jpg", "image/jpeg"], ["PNG", "png", "image/png"], ["WebP", "webp", "image/webp"],
  ])("returns a bounded safe %s response from a V2 Profile event", async (_label, extension, mime) => {
    const url = `${baseUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/${objectId}.${extension}`;
    const { calls } = installFetch(rpcV2({ comparison: { before: fullProfile(null), after: fullProfile(url) } }),
      new Response(bytes, { headers: { "Content-Type": mime } }));
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("content-type")).toBe(mime);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(calls.map(call => call.url)).toEqual([
      `${baseUrl}/rest/v1/rpc/read_version_history_v1`,
      `${baseUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/${objectId}.${extension}`,
    ]);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers && new Headers(calls[0].init?.headers).get("authorization")).toBe(`Bearer ${token()}`);
    expect(calls[1]?.init?.method).toBe("GET");
    expect(calls[1]?.init?.redirect).toBe("manual");
    expect(new Headers(calls[1]?.init?.headers).has("authorization")).toBe(false);
    expect(calls.some(call => /save_|restore_|delete|upload|activity_log.*write/i.test(call.url))).toBe(false);
  });

  it("resolves only a target-bound V1 profile_image object_key", async () => {
    const key = `${resumeId}/profile/${objectId}.png`;
    const { calls } = installFetch(rpcV1({ before: null, after: key }));
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(200);
    expect(calls[1]?.url).toBe(`${baseUrl}/storage/v1/object/public/profile-images/${key}`);
  });

  it("uses the next exact microsecond cursor for the maximum UUID without losing timestamp precision", async () => {
    const maximumEventId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const { calls } = installFetch(rpcV2({ event_id: maximumEventId }));
    const response = await handleWorkerRequest(request(validBody({ event_id: maximumEventId })), env());
    expect(response.status).toBe(200);
    const rpcBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(rpcBody).toMatchObject({
      before_occurred_at: "2026-10-05T02:10:04.438176Z",
      before_event_id: "00000000-0000-0000-0000-000000000000",
    });
  });

  it("requires authentication before any RPC or Storage request", async () => {
    const { fetchMock } = installFetch();
    const response = await handleWorkerRequest(request(validBody(), false), env());
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the authenticated RPC target/capability denial without Storage access", async () => {
    const { calls } = installFetch(Response.json({ code: "42501", message: "denied" }, { status: 403 }));
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "target_not_authorized" } });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["another target event", rpcV2({ event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
    ["non-Profile domain", rpcV2({ domain_key: "awards" })],
    ["unsupported operation", rpcV2({ operation: "delete" })],
    ["unsupported entity", rpcV2({ entity_type: "profile_image" })],
    ["unknown payload version", rpcV2({ payload_version: 99 })],
    ["malformed V2 aggregate", rpcV2({ comparison: { before: {}, after: fullProfile(photoUrl) } })],
    ["malformed history row", rpcV2({ ip_network: "private" })],
  ])("returns generic unavailable for %s without fetching Storage", async (_label, row) => {
    const { calls } = installFetch(row);
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "image_unavailable", message: "Historical image preview is unavailable." } });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["external URL", "https://outside.test/image.png"],
    ["wrong origin", "https://other.supabase.co/storage/v1/object/public/profile-images/" + resumeId + "/profile/" + objectId + ".png"],
    ["wrong bucket", `${baseUrl}/storage/v1/object/public/other/${resumeId}/profile/${objectId}.png`],
    ["wrong target", `${baseUrl}/storage/v1/object/public/profile-images/${otherResumeId}/profile/${objectId}.png`],
    ["wrong path segment", `${baseUrl}/storage/v1/object/public/profile-images/${resumeId}/other/${objectId}.png`],
    ["non-UUID filename", `${baseUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/not-a-uuid.png`],
    ["unsupported extension", `${baseUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/${objectId}.svg`],
    ["query string", `${photoUrl}?token=signed`], ["fragment", `${photoUrl}#x`],
    ["percent encoding", photoUrl.replace("profile-images", "profile%2Dimages")],
    ["backslash", photoUrl.replace("/profile/", "/profile\\/" )],
    ["traversal", `${baseUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/../${objectId}.png`],
  ])("rejects a V2 %s without a Storage request", async (_label, reference) => {
    const { calls } = installFetch(rpcV2({ comparison: { before: fullProfile(null), after: fullProfile(reference) } }));
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["cross-target V1 key", `${otherResumeId}/profile/${objectId}.png`],
    ["URL in object_key", photoUrl], ["legacy object", "legacy/photo.png"],
    ["query in object key", `${resumeId}/profile/${objectId}.png?token=x`],
    ["percent-encoded key", `${resumeId}/profile/${objectId}%2epng`],
    ["traversal key", `${resumeId}/profile/../${objectId}.png`],
    ["malformed V1 change", { before: null, after: `${resumeId}/profile/${objectId}.png`, file_name: "private.png" }],
  ])("rejects a V1 %s without a Storage request", async (_label, objectKey) => {
    const { calls } = installFetch(rpcV1({ before: null, after: objectKey }));
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("accepts only the selected value from a validated event comparison", async () => {
    const { calls } = installFetch(rpcV2());
    const response = await handleWorkerRequest(request(validBody({ side: "before" })), env());
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["redirect", new Response(null, { status: 302, headers: { Location: "https://outside.test/image.png" } })],
    ["missing object / NoSuchKey", Response.json({ error: "NoSuchKey" }, { status: 400 })],
    ["partial content", new Response(bytes, { status: 206, headers: { "Content-Type": "image/png" } })],
    ["upstream error", new Response("failure", { status: 503 })],
    ["HTML", new Response("<html>", { headers: { "Content-Type": "text/html" } })],
    ["JSON", Response.json({ ok: false })],
    ["octet stream", new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })],
    ["SVG", new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } })],
    ["MIME/extension mismatch", new Response(bytes, { headers: { "Content-Type": "image/jpeg" } })],
    ["MIME parameters", new Response(bytes, { headers: { "Content-Type": "image/png; charset=utf-8" } })],
  ])("returns generic unavailable for upstream %s", async (_label, upstream) => {
    const { calls } = installFetch(rpcV2(), upstream);
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it("rejects an oversized declared body before reading it", async () => {
    const tooLarge = new Response(bytes, { headers: { "Content-Type": "image/png", "Content-Length": String(5 * 1024 * 1024 + 1) } });
    const { calls } = installFetch(rpcV2(), tooLarge);
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it("enforces the actual streamed size when Content-Length is absent", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(oversized); controller.close(); } });
    const upstream = new Response(stream, { headers: { "Content-Type": "image/png" } });
    const { calls } = installFetch(rpcV2(), upstream);
    const response = await handleWorkerRequest(request(validBody()), env());
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["missing event UUID", { ...validBody(), event_id: undefined }],
    ["extra URL authority", { ...validBody(), url: photoUrl }],
    ["wrong side", validBody({ side: "current" })],
    ["invalid timestamp", validBody({ occurred_at: "not-a-date" })],
  ])("rejects malformed request with %s before RPC", async (_label, body) => {
    const { fetchMock } = installFetch();
    const response = await handleWorkerRequest(request(body), env());
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses only the authenticated read RPC followed by a fixed-origin Storage GET", async () => {
    const { calls } = installFetch(rpcV2());
    await handleWorkerRequest(request(validBody()), env());
    const rpcBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(rpcBody).toEqual({ target_resume_id: resumeId, page_limit: 1, before_occurred_at: timestamp,
      before_event_id: "c6d3d789-6335-4e02-b957-ede24a4d09ac" });
    expect(calls.map(call => call.init?.method)).toEqual(["POST", "GET"]);
    expect(calls.every(call => !/save_|restore_domain|restore_resume|delete/i.test(call.url))).toBe(true);
    expect(new Headers(calls[1]?.init?.headers).get("accept")).toBe("image/jpeg,image/png,image/webp");
  });
});
