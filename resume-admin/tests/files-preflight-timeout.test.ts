import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeFiles, type FilesAggregate } from "../src/data/websiteFilesAggregate";
import { createFilesSaveOperation, createResumeRepository, type ResumeRepository } from "../src/data/resumeRepository";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const uploadRequestId = "11111111-1111-4111-8111-111111111111";
const files: FilesAggregate = { translations: { zh: { portfolio_href: "https://legacy.test/zh.pdf" }, en: { portfolio_href: "https://legacy.test/en.pdf" } } };
const managedReference = `https://storage.example.test/storage/v1/object/public/resume-files/${resumeId}/zh/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeRepository(getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "test-token", expires_at: 4_000_000_000 } }, error: null }), fetchImpl = vi.fn(async () => Response.json({ reference: managedReference, upload_request_id: uploadRequestId })) as unknown as typeof fetch, rpc = vi.fn()) {
  const client = { auth: { getSession }, rpc } as unknown as SupabaseClient;
  vi.stubGlobal("fetch", fetchImpl);
  return { repository: createResumeRepository(client, "https://storage.example.test") as ResumeRepository, getSession, fetchImpl };
}

function makeFile(arrayBuffer: () => Promise<ArrayBuffer> = async () => new Uint8Array([1, 2, 3]).buffer) {
  const file = new File([new Uint8Array([1, 2, 3])], "resume.pdf", { type: "application/pdf", lastModified: 123 });
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: arrayBuffer });
  return file;
}

async function advanceToTimeout(promise: Promise<unknown>, timeoutMs: number, phrase: string) {
  const assertion = expect(promise).rejects.toThrow(phrase);
  await vi.advanceTimersByTimeAsync(timeoutMs);
  await assertion;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("D-8 bounded pre-request Files operations", () => {
  it("bounds File.arrayBuffer and fences a late resolution before upload", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MODE", "qa");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const read = deferred<ArrayBuffer>();
    const { repository, fetchImpl } = makeRepository();
    const operation = createFilesSaveOperation();
    const request = repository.uploadResumePdfWithWorker!(resumeId, "zh", makeFile(() => read.promise), operation);
    await advanceToTimeout(request, 15_000, "file read timed out before a request was sent");
    expect(operation.isActive()).toBe(false);
    const records = info.mock.calls.filter(call => call[0] === "d8_files_client_stage").map(call => call[1] as Record<string, unknown>);
    expect(records.map(record => record.stage)).toEqual(["file_read_started", "file_read_completed"]);
    expect(records[1]?.category).toBe("timeout_or_cancelled");
    read.resolve(new Uint8Array([1, 2, 3]).buffer);
    await Promise.resolve(); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds crypto.subtle.digest and fences a late resolution before upload", async () => {
    vi.useFakeTimers();
    const digest = deferred<ArrayBuffer>();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => uploadRequestId), subtle: { digest: vi.fn(() => digest.promise) } });
    const { repository, fetchImpl } = makeRepository();
    const operation = createFilesSaveOperation();
    const request = repository.uploadResumePdfWithWorker!(resumeId, "zh", makeFile(), operation);
    await advanceToTimeout(request, 15_000, "file verification timed out before a request was sent");
    digest.resolve(new Uint8Array(32).buffer);
    await Promise.resolve(); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds upload session acquisition and fences a late session before upload", async () => {
    vi.useFakeTimers();
    const session = deferred<{ data: { session: { access_token: string; expires_at: number } }; error: null }>();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => uploadRequestId), subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const { repository, fetchImpl } = makeRepository(vi.fn(() => session.promise));
    const operation = createFilesSaveOperation();
    const request = repository.uploadResumePdfWithWorker!(resumeId, "zh", makeFile(), operation);
    await advanceToTimeout(request, 10_000, "session check timed out before a request was sent");
    expect(window.sessionStorage.getItem(`admin-files-upload-pending-v1:${resumeId}:zh`)).toContain(uploadRequestId);
    session.resolve({ data: { session: { access_token: "late-token", expires_at: 4_000_000_000 } }, error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds pending Files-save session acquisition and fences a late session before save", async () => {
    vi.useFakeTimers();
    const session = deferred<{ data: { session: { access_token: string; expires_at: number } }; error: null }>();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { repository } = makeRepository(vi.fn(() => session.promise), fetchImpl);
    window.sessionStorage.setItem(`admin-files-rpc-pending-v1:${resumeId}`, JSON.stringify({
      requestId: uploadRequestId, resumeId, canonical: canonicalizeFiles(files), uploadRequestIds: {},
    }));
    const operation = createFilesSaveOperation();
    const request = repository.retryPendingFilesWithWorker!(resumeId, operation);
    await advanceToTimeout(request, 10_000, "session check timed out before a request was sent");
    session.resolve({ data: { session: { access_token: "late-token", expires_at: 4_000_000_000 } }, error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds the Files write-state RPC and ignores a late resolution", async () => {
    vi.useFakeTimers();
    const state = deferred<{ data: unknown; error: null }>();
    const rpc = vi.fn(() => state.promise);
    const { repository, fetchImpl } = makeRepository(undefined, undefined, rpc);
    const operation = createFilesSaveOperation();
    const request = repository.loadAdminFilesWriteState!(resumeId, operation);
    await advanceToTimeout(request, 15_000, "write-state check timed out before a request was sent");
    expect(operation.isActive()).toBe(false);
    state.resolve({ data: [{ resume_id: resumeId, activity_log_enabled: true, files_write_mode: "rpc", files_trusted_context_required: true, storage_protocol: "intent_v1" }], error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds candidate cleanup session acquisition and fences late session resolution", async () => {
    vi.useFakeTimers();
    const session = deferred<{ data: { session: { access_token: string; expires_at: number } }; error: null }>();
    const { repository, fetchImpl } = makeRepository(vi.fn(() => session.promise));
    const operation = createFilesSaveOperation();
    const cleanup = repository.cleanupResumePdfCandidatesWithWorker!(resumeId, [uploadRequestId], operation);
    const result = expect(cleanup).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(operation.isActive()).toBe(false);
    session.resolve({ data: { session: { access_token: "late-token", expires_at: 4_000_000_000 } }, error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not issue cleanup when unmounted while cleanup session acquisition is pending", async () => {
    const session = deferred<{ data: { session: { access_token: string; expires_at: number } }; error: null }>();
    const { repository, fetchImpl } = makeRepository(vi.fn(() => session.promise));
    const oldOperation = createFilesSaveOperation();
    const newerOperation = createFilesSaveOperation();
    const cleanup = repository.cleanupResumePdfCandidatesWithWorker!(resumeId, [uploadRequestId], oldOperation);
    oldOperation.abandon();
    session.resolve({ data: { session: { access_token: "late-token", expires_at: 4_000_000_000 } }, error: null });
    await expect(cleanup).resolves.toBe(true);
    expect(newerOperation.isActive()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reuses upload identity after a pre-request timeout and rejects a changed file", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => uploadRequestId), subtle: { digest: vi.fn(async (_algorithm: string, bytes: BufferSource) => {
      const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return new Uint8Array(32).fill(data[0] ?? 0).buffer;
    }) } });
    const hanging = deferred<{ data: { session: { access_token: string; expires_at: number } }; error: null }>();
    const fetchImpl = vi.fn(async () => Response.json({ reference: managedReference, upload_request_id: uploadRequestId })) as unknown as typeof fetch;
    const { repository, getSession } = makeRepository(vi.fn().mockImplementationOnce(() => hanging.promise).mockResolvedValue({ data: { session: { access_token: "test-token", expires_at: 4_000_000_000 } }, error: null }), fetchImpl);
    const file = makeFile();
    const first = repository.uploadResumePdfWithWorker!(resumeId, "zh", file, createFilesSaveOperation());
    await advanceToTimeout(first, 10_000, "session check timed out");
    const stored = JSON.parse(window.sessionStorage.getItem(`admin-files-upload-pending-v1:${resumeId}:zh`)!) as { requestId: string };
    await expect(repository.uploadResumePdfWithWorker!(resumeId, "zh", file, createFilesSaveOperation())).resolves.toMatchObject({ uploadRequestId: stored.requestId });
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const uploadHeaders = new Headers((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers);
    expect(uploadHeaders.get("X-Upload-Request-ID")).toBe(stored.requestId);
    expect(uploadHeaders.get("X-Original-Filename-UTF8-Percent-Encoded")).toBe(encodeURIComponent(file.name));
    expect(uploadHeaders.has("X-Original-Filename")).toBe(false);

    const changed = makeFile(async () => new Uint8Array([9, 2, 3]).buffer);
    await expect(repository.uploadResumePdfWithWorker!(resumeId, "zh", changed, createFilesSaveOperation())).rejects.toThrow(/exact same file/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies header construction failure as not sent and preserves the exact pending identity", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => uploadRequestId), subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const { repository, fetchImpl } = makeRepository();
    const NativeHeaders = globalThis.Headers;
    vi.stubGlobal("Headers", class { constructor() { throw new TypeError("synthetic header construction failure"); } });
    const file = makeFile();
    const key = `admin-files-upload-pending-v1:${resumeId}:zh`;
    await expect(repository.uploadResumePdfWithWorker!(resumeId, "zh", file, createFilesSaveOperation()))
      .rejects.toMatchObject({ uncertain: false, message: expect.stringContaining("no request was sent") });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.parse(window.sessionStorage.getItem(key)!).requestId).toBe(uploadRequestId);

    vi.stubGlobal("Headers", NativeHeaders);
    await expect(repository.uploadResumePdfWithWorker!(resumeId, "zh", file, createFilesSaveOperation()))
      .resolves.toMatchObject({ uploadRequestId });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(new Headers((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).get("X-Upload-Request-ID")).toBe(uploadRequestId);
  });

  it("keeps a rejected fetch after invocation uncertain without automatic replay", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => uploadRequestId), subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const fetchImpl = vi.fn(async () => { throw new TypeError("network failure"); }) as unknown as typeof fetch;
    const { repository } = makeRepository(undefined, fetchImpl);
    await expect(repository.uploadResumePdfWithWorker!(resumeId, "zh", makeFile(), createFilesSaveOperation()))
      .rejects.toMatchObject({ uncertain: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(window.sessionStorage.getItem(`admin-files-upload-pending-v1:${resumeId}:zh`)!).requestId).toBe(uploadRequestId);
  });

  it("aborts an actually timed-out upload and preserves its exact upload identity", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => uploadRequestId), subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    let issuedSignal: AbortSignal | undefined;
    const uploadFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      issuedSignal = init?.signal as AbortSignal;
      issuedSignal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    const uploadRepo = makeRepository(undefined, uploadFetch).repository;
    const request = uploadRepo.uploadResumePdfWithWorker!(resumeId, "zh", makeFile());
    const assertion = expect(request).rejects.toMatchObject({ uncertain: true });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(issuedSignal?.aborted).toBe(true);
    expect(window.sessionStorage.getItem(`admin-files-upload-pending-v1:${resumeId}:zh`)).toContain(uploadRequestId);
  });

  it("aborts an actually timed-out Files save and preserves its exact request identity", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => uploadRequestId) });
    let issuedSignal: AbortSignal | undefined;
    const saveFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      issuedSignal = init?.signal as AbortSignal;
      issuedSignal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    const saveRepo = makeRepository(undefined, saveFetch).repository;
    const operation = createFilesSaveOperation();
    const request = saveRepo.saveFilesWithWorker!(resumeId, files, {}, operation);
    const assertion = expect(request).rejects.toMatchObject({ uncertain: true });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(issuedSignal?.aborted).toBe(true);
    expect(window.sessionStorage.getItem(`admin-files-rpc-pending-v1:${resumeId}`)).toContain(uploadRequestId);
  });

  it("aborts an actually timed-out candidate cleanup and retains upload identity for reconciliation", async () => {
    vi.useFakeTimers();
    const key = `admin-files-upload-pending-v1:${resumeId}:zh`;
    window.sessionStorage.setItem(key, JSON.stringify({ requestId: uploadRequestId }));
    let issuedSignal: AbortSignal | undefined;
    const cleanupFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      issuedSignal = init?.signal as AbortSignal;
      issuedSignal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    const repository = makeRepository(undefined, cleanupFetch).repository;
    const operation = createFilesSaveOperation();
    const cleanup = repository.cleanupResumePdfCandidatesWithWorker!(resumeId, [uploadRequestId], operation);
    const result = expect(cleanup).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(issuedSignal?.aborted).toBe(true);
    expect(window.sessionStorage.getItem(key)).toContain(uploadRequestId);
  });

  it("keeps an issued pending Files-save retry ambiguous and preserves its original identity", async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException("request timed out", "AbortError"); }) as unknown as typeof fetch;
    const { repository } = makeRepository(undefined, fetchImpl);
    window.sessionStorage.setItem(`admin-files-rpc-pending-v1:${resumeId}`, JSON.stringify({
      requestId: uploadRequestId, resumeId, canonical: canonicalizeFiles(files), uploadRequestIds: { zh: "22222222-2222-4222-8222-222222222222" },
    }));
    await expect(repository.retryPendingFilesWithWorker!(resumeId)).rejects.toMatchObject({ uncertain: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(`admin-files-rpc-pending-v1:${resumeId}`)).toContain(uploadRequestId);
  });
});
