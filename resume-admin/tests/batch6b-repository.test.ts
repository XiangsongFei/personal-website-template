import { afterEach, describe, expect, it, vi } from "vitest";
import { createFilesSaveOperation, createResumeRepository } from "../src/data/resumeRepository";
import type { SupabaseClient } from "@supabase/supabase-js";

const resumeId = "11111111-1111-4111-8111-111111111111";
const projectId = "project-id";
const methodId = "method-id";
function pdfFile(contents: string, name = "resume.pdf", lastModified = 123): File {
  const file = new File([contents], name, { type: "application/pdf", lastModified });
  const bytes = new TextEncoder().encode(contents);
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: async () => bytes.slice().buffer });
  return file;
}
function pdfBlob(contents: string): Blob {
  const blob = new Blob([contents], { type: "application/pdf" });
  Object.defineProperty(blob, "arrayBuffer", { configurable: true, value: async () => new TextEncoder().encode(contents).buffer });
  return blob;
}
function legacyDigest(buffer: BufferSource): ArrayBuffer {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) output[index] = (hash >>> ((index % 4) * 8)) & 0xff;
  return output.buffer;
}
function stubLegacyCryptoWithoutUuid(): void {
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async (_algorithm: AlgorithmIdentifier, data: BufferSource) => legacyDigest(data)) } });
}
function database() {
  const calls: Array<{ table: string; op: string; payload?: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const storageUpload = vi.fn(async (_path: string, _file: File, _options?: Record<string, unknown>): Promise<{ error: Error | null }> => {
    void _path; void _file; void _options;
    return { error: null };
  });
  const storageInfo = vi.fn(async (_path: string): Promise<{ data: unknown; error: Error | null }> => {
    void _path;
    return { data: { metadata: {} }, error: null };
  });
  const storageDownload = vi.fn(async (_path: string, _options?: unknown, _parameters?: { cache?: RequestCache; signal?: AbortSignal }): Promise<{ data: Blob | null; error: Error | null }> => { void _path; void _options; void _parameters; return { data: null, error: new Error("not found") }; });
  const storageRemove = vi.fn(async (_paths: string[]): Promise<{ data: unknown[]; error: Error | null }> => {
    void _paths;
    return { data: [{}], error: null };
  });
  const getPublicUrl = vi.fn((path: string, bucket = "profile-images") => ({ data: { publicUrl: bucket === "resume-files"
    ? `https://storage.example.test/storage/v1/object/public/${bucket}/${path}` : `https://storage.example.test/${path}` } }));
  const storageFrom = vi.fn((bucket = "profile-images") => ({ upload: storageUpload, download: storageDownload, info: storageInfo, remove: storageRemove, getPublicUrl: (path: string) => getPublicUrl(path, bucket) }));
  let localeRows = [{ portfolio_href: "" }, { portfolio_href: "" }];
  let localeReadError: Error | null = null;
  const from = vi.fn((table: string) => {
    const call = { table, op: "select", filters: [] as Array<[string, unknown]>, payload: undefined as Record<string, unknown> | undefined };
    calls.push(call);
    const q: Record<string, (...args: never[]) => unknown> = {};
    q.insert = ((payload: Record<string, unknown>) => { call.op = "insert"; call.payload = payload; return q; }) as never;
    q.update = ((payload: Record<string, unknown>) => { call.op = "update"; call.payload = payload; return q; }) as never;
    q.delete = (() => { call.op = "delete"; return q; }) as never;
    q.select = (() => q) as never;
    q.eq = ((key: string, value: unknown) => { call.filters.push([key, value]); return q; }) as never;
    q.in = ((key: string, values: unknown[]) => { call.filters.push([key, values]); return q; }) as never;
    const response = () => {
      if (table === "resume_project_methods") return { id: methodId, resume_id: resumeId, project_entry_id: projectId, locale: call.payload?.locale ?? call.filters.find(([key]) => key === "locale")?.[1] ?? "zh", position: call.payload?.position ?? 0, value: call.payload?.value ?? "method", ...(call.payload ?? {}) };
      if (table === "resume_project_entries") return { id: projectId, resume_id: resumeId, position: 0, source_key: null, ...(call.payload ?? {}) };
      if (table === "resume_contact_focus_items") return { id: projectId, resume_id: resumeId, position: 0, ...(call.payload ?? {}) };
      if (table === "resume_contact_status_items") return { id: projectId, resume_id: resumeId, position: 0, status_type: "study", ...(call.payload ?? {}) };
      if (table === "resume_navigation_item_translations") return { resume_id: resumeId, navigation_item_id: "nav-id", locale: "zh", label: "中文", ...(call.payload ?? {}) };
      if (table === "resume_public_links") return { resume_id: resumeId };
      if (table === "resume_locale_content") return { resume_id: resumeId, locale: call.filters.find(([key]) => key === "locale")?.[1] ?? "en", ...(call.payload ?? {}) };
      return { resume_id: resumeId, project_entry_id: projectId, locale: "zh", title: "title", subtitle: "subtitle", period: "period", description: "description", href: "/", ...(call.payload ?? {}) };
    };
    q.single = (async () => ({ data: response(), error: null })) as never;
    q.maybeSingle = (async () => ({ data: response(), error: null })) as never;
    q.then = ((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(table === "resume_locale_content" && call.op === "select"
      ? { data: localeRows, error: localeReadError } : { data: response(), error: null }).then(resolve, reject)) as never;
    return q;
  });
  return { client: { from, storage: { from: storageFrom }, supabaseUrl: "https://storage.example.test" } as unknown as SupabaseClient, calls, storageUpload, storageDownload, storageInfo, storageRemove, getPublicUrl, storageFrom,
    setLocaleRows(rows: Array<{ portfolio_href: string }>) { localeRows = rows; }, setLocaleReadError(error: Error | null) { localeReadError = error; } };
}

afterEach(() => { window.sessionStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Batch 6B scoped repository writes", () => {
  it("uploads validated profile photos to unique non-overwriting paths in profile-images", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    const first = new File(["photo"], "portrait.webp", { type: "image/webp" });
    const second = new File(["photo2"], "portrait.webp", { type: "image/webp" });
    const firstUrl = await repo.uploadProfilePhoto!(resumeId, first);
    await repo.uploadProfilePhoto!(resumeId, second);
    expect(db.storageFrom).toHaveBeenCalledWith("profile-images");
    const paths = db.storageUpload.mock.calls.map(call => call[0]);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(new RegExp(`^${resumeId}/profile/[0-9a-f-]{36}\\.webp$`, "i"));
    expect(paths[1]).not.toBe(paths[0]);
    expect(db.storageUpload).toHaveBeenNthCalledWith(1, paths[0], first, { upsert: false, contentType: "image/webp", cacheControl: "31536000" });
    expect(db.getPublicUrl).toHaveBeenCalledWith(paths[1], "profile-images");
    expect(firstUrl).toBe(`https://storage.example.test/${paths[0]}`);
  });
  it("uploads Profile photos with unique paths and remains retryable when crypto.randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    try {
      const db = database();
      db.storageUpload.mockResolvedValueOnce({ error: new Error("temporary storage failure") });
      const repo = createResumeRepository(db.client);
      const file = new File(["photo"], "portrait.png", { type: "image/png" });

      await expect(repo.uploadProfilePhoto!(resumeId, file)).rejects.toThrow("Profile photo upload failed.");
      const savedUrl = await repo.uploadProfilePhoto!(resumeId, file);

      const paths = db.storageUpload.mock.calls.map(([path]) => path);
      expect(paths).toHaveLength(2);
      expect(paths[0]).toMatch(new RegExp(`^${resumeId}/profile/[0-9a-f-]{36}\\.png$`, "i"));
      expect(paths[1]).toMatch(new RegExp(`^${resumeId}/profile/[0-9a-f-]{36}\\.png$`, "i"));
      expect(paths[1]).not.toBe(paths[0]);
      expect(db.storageUpload).toHaveBeenCalledTimes(2);
      expect(savedUrl).toBe(`https://storage.example.test/${paths[1]}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("deletes only a canonical managed profile object from the profile-images bucket", async () => {
    const db = database(); const repo = createResumeRepository(db.client, "https://project.example.test");
    const url = "https://project.example.test/storage/v1/object/public/profile-images/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png";
    await expect(repo.deleteManagedProfilePhoto!("11111111-1111-4111-8111-111111111111", url)).resolves.toBe(true);
    expect(db.storageFrom).toHaveBeenCalledWith("profile-images");
    expect(db.storageRemove).toHaveBeenCalledExactlyOnceWith(["11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png"]);
  });
  it("never sends foreign or malformed profile URLs to Storage removal", async () => {
    const db = database(); const repo = createResumeRepository(db.client, "https://project.example.test");
    const urls = [
      "https://external.example.test/storage/v1/object/public/profile-images/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
      "https://project.example.test/storage/v1/object/public/profile-images/22222222-2222-4222-8222-222222222222/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
      "https://project.example.test/storage/v1/object/public/profile-images/example-cv/profile/photo.png",
      "https://project.example.test/storage/v1/object/public/profile-images/11111111-1111-4111-8111-111111111111/profile/%2e%2e%2fphoto.png",
    ];
    for (const url of urls) await expect(repo.deleteManagedProfilePhoto!("11111111-1111-4111-8111-111111111111", url)).resolves.toBe(false);
    expect(db.storageRemove).not.toHaveBeenCalled();
  });
  it("does not report cleanup success if Storage deletion errors or returns no deleted object", async () => {
    const db = database(); const repo = createResumeRepository(db.client, "https://project.example.test");
    const url = "https://project.example.test/storage/v1/object/public/profile-images/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png";
    db.storageRemove.mockResolvedValueOnce({ data: [], error: null });
    await expect(repo.deleteManagedProfilePhoto!("11111111-1111-4111-8111-111111111111", url)).rejects.toThrow("Profile photo cleanup was not confirmed.");
    db.storageRemove.mockResolvedValueOnce({ data: [], error: new Error("storage unavailable") });
    await expect(repo.deleteManagedProfilePhoto!("11111111-1111-4111-8111-111111111111", url)).rejects.toThrow("Profile photo cleanup was not confirmed.");
  });
  it("accepts only JPEG, PNG, and WebP up to 5 MB before contacting Storage", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      await expect(repo.uploadProfilePhoto!(resumeId, new File(["image"], "photo", { type }))).resolves.toMatch(/storage\.example\.test/);
    }
    await expect(repo.uploadProfilePhoto!(resumeId, new File(["svg"], "photo.svg", { type: "image/svg+xml" }))).rejects.toThrow("JPG, PNG, or WebP");
    const tooLarge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    await expect(repo.uploadProfilePhoto!(resumeId, tooLarge)).rejects.toThrow("5 MB or smaller");
    expect(db.storageUpload).toHaveBeenCalledTimes(3);
  });
  it("inserts methods with actual project identity and returns the database UUID", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    const row = await repo.insertProjectMethod!(resumeId, projectId, "zh", 2, "新方法");
    expect(row).toEqual({ resumeId, projectId, methodId, locale: "zh", position: 2, value: "新方法" });
    expect(db.calls[0]).toMatchObject({ table: "resume_project_methods", op: "insert", payload: { resume_id: resumeId, project_entry_id: projectId, locale: "zh", position: 2, value: "新方法" } });
  });
  it("scopes method updates by resume, project, real method UUID, and locale", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await repo.updateProjectMethod!(resumeId, projectId, methodId, "en", { value: "Changed" });
    expect(db.calls[0]).toMatchObject({ table: "resume_project_methods", op: "update", payload: { value: "Changed" }, filters: [["resume_id", resumeId], ["project_entry_id", projectId], ["id", methodId], ["locale", "en"]] });
  });
  it("updates only explicitly changed locale-content columns", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await repo.updateSiteText!(resumeId, "en", { educationLabel: "Education updated" });
    expect(db.calls[0]).toMatchObject({ table: "resume_locale_content", op: "update", payload: { education_label: "Education updated" }, filters: [["resume_id", resumeId], ["locale", "en"]] });
    expect(Object.keys(db.calls[0].payload!)).toEqual(["education_label"]);
  });
  it("keeps navigation writes label-only and locale-scoped", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await repo.updateNavigationLabel!(resumeId, "nav-id", "zh", "经历");
    expect(db.calls[0]).toMatchObject({ table: "resume_navigation_item_translations", op: "update", payload: { label: "经历" }, filters: [["resume_id", resumeId], ["navigation_item_id", "nav-id"], ["locale", "zh"]] });
  });
  it("keeps status type on parent insertion and writes Availability for either locale", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await repo.insertStatus!(resumeId, 0, "graduation");
    expect(db.calls[0]).toEqual({ table: "resume_contact_status_items", op: "insert", payload: { resume_id: resumeId, position: 0, status_type: "graduation" }, filters: [] });
    await repo.updateContactAvailability!(resumeId, "zh", "新的中文状态");
    expect(db.calls[1]).toMatchObject({ table: "resume_locale_content", op: "update", payload: { availability: "新的中文状态" }, filters: [["resume_id", resumeId], ["locale", "zh"]] });
    await repo.updateContactAvailability!(resumeId, "en", "New English availability");
    expect(db.calls[2]).toMatchObject({ table: "resume_locale_content", op: "update", payload: { availability: "New English availability" }, filters: [["resume_id", resumeId], ["locale", "en"]] });
  });
  it("creates Focus using only columns present in the production Focus table", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    const result = await repo.insertFocus!(resumeId, 2);
    expect(db.calls[0]).toEqual({ table: "resume_contact_focus_items", op: "insert", payload: { resume_id: resumeId, position: 2 }, filters: [] });
    expect(result).toEqual({ resumeId, entryId: projectId, position: 2, sourceKey: null });
  });
  it("writes only changed public-link values", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await repo.updatePublicLinks!(resumeId, { github: "https://github.example.test/new" });
    expect(db.calls[0]).toMatchObject({ table: "resume_public_links", op: "update", payload: { github: "https://github.example.test/new" }, filters: [["resume_id", resumeId]] });
  });
  it.each(["zh", "en"] as const)("uploads the %s PDF to a unique non-overwriting managed candidate path", async locale => {
    stubLegacyCryptoWithoutUuid();
    const db = database(); const repo = createResumeRepository(db.client, "https://storage.example.test");
    const file = pdfFile("%PDF-1.7 test", `resume-${locale}.pdf`);
    const uploadedUrl = await repo.uploadResumePdf!(resumeId, locale, file);
    const parsedUrl = new URL(uploadedUrl);
    expect(parsedUrl.origin).toBe("https://storage.example.test");
    expect(parsedUrl.pathname).toMatch(new RegExp(`/storage/v1/object/public/resume-files/${resumeId}/${locale}/[0-9a-f-]{36}\\.pdf$`));
    expect(db.storageFrom).toHaveBeenCalledWith("resume-files");
    const [path, , options] = db.storageUpload.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^${resumeId}/${locale}/[0-9a-f-]{36}\\.pdf$`));
    expect(options).toMatchObject({ upsert: false, contentType: "application/pdf", metadata: { originalFilename: file.name } });
    expect(db.getPublicUrl).toHaveBeenCalledWith(path, "resume-files");
  });
  it("reuses a stable candidate path until its Files reference is confirmed", async () => {
    stubLegacyCryptoWithoutUuid();
    const db = database();
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    const file = pdfFile("%PDF replacement", "replacement.pdf");

    const first = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));
    const second = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));
    expect(first.pathname).toBe(second.pathname);
    expect(first.search).toBe(""); expect(first.hash).toBe("");
    expect(db.storageUpload).toHaveBeenCalledTimes(2);
    expect(db.storageUpload.mock.calls.every(([path]) => path.startsWith(`${resumeId}/zh/`))).toBe(true);
    expect(db.storageUpload.mock.calls.every(([, , options]) => options?.upsert === false)).toBe(true);
  });
  it("retains and reuses the UUID-shaped candidate path after a rejected upload response", async () => {
    stubLegacyCryptoWithoutUuid();
    try {
      const db = database();
      db.storageUpload.mockResolvedValueOnce({ error: new Error("temporary storage failure") });
      const repo = createResumeRepository(db.client, "https://storage.example.test");
      const file = pdfFile("%PDF test", "费湘淞_中文简历.pdf");

      await expect(repo.uploadResumePdf!(resumeId, "zh", file)).rejects.toThrow(/candidate identity is retained/i);
      const firstRetryUrl = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));
      const secondSuccessUrl = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));

      expect(db.storageFrom).toHaveBeenCalledWith("resume-files");
      expect(db.storageUpload).toHaveBeenCalledTimes(3);
      const paths = db.storageUpload.mock.calls.map(([path]) => path);
      expect(paths).toHaveLength(3);
      expect(paths.every(path => new RegExp(`^${resumeId}/zh/[0-9a-f-]{36}\\.pdf$`).test(path))).toBe(true);
      expect(new Set(paths).size).toBe(1);
      expect(db.storageUpload.mock.calls.every(([, , options]) => options?.upsert === false)).toBe(true);
      expect(firstRetryUrl.pathname).toBe(secondSuccessUrl.pathname);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects invalid PDF files and files above 10 MB before contacting Storage", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await expect(repo.uploadResumePdf!(resumeId, "zh", new File(["not pdf"], "bad.txt", { type: "text/plain" }))).rejects.toThrow("Resume PDF must be a PDF file.");
    const tooLarge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });
    await expect(repo.uploadResumePdf!(resumeId, "en", tooLarge)).rejects.toThrow("Resume PDF must be 10 MB or smaller.");
    expect(db.storageUpload).not.toHaveBeenCalled();
  });
  it("does not claim success when the Storage upload fails", async () => {
    const db = database(); db.storageUpload.mockResolvedValueOnce({ error: new Error("storage unavailable") });
    const repo = createResumeRepository(db.client);
    await expect(repo.uploadResumePdf!(resumeId, "zh", pdfFile("pdf"))).rejects.toThrow("Legacy PDF upload was not confirmed.");
    expect(db.getPublicUrl).not.toHaveBeenCalled();
  });
  it("reconciles a same-file retry by verifying the stored candidate digest", async () => {
    stubLegacyCryptoWithoutUuid();
    const db = database();
    const file = pdfFile("%PDF same bytes", "resume.pdf", 456);
    db.storageUpload.mockResolvedValueOnce({ error: new Error("candidate already exists") });
    db.storageDownload.mockResolvedValueOnce({ data: pdfBlob("%PDF same bytes"), error: null });
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    await expect(repo.uploadResumePdf!(resumeId, "zh", file)).resolves.toContain(`/${resumeId}/zh/`);
    expect(db.storageUpload).toHaveBeenCalledOnce();
    expect(db.storageDownload).toHaveBeenCalledOnce();
    expect(db.storageDownload.mock.calls[0]).toEqual([expect.stringMatching(new RegExp(`^${resumeId}/zh/[0-9a-f-]{36}\\.pdf$`, "i")), {}, { cache: "no-store" }]);
  });
  it("fails closed when an existing legacy candidate has different bytes", async () => {
    const digest = vi.fn().mockResolvedValueOnce(new Uint8Array(32).fill(1).buffer).mockResolvedValueOnce(new Uint8Array(32).fill(2).buffer);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), subtle: { digest } });
    const db = database();
    db.storageUpload.mockResolvedValueOnce({ error: new Error("candidate already exists") });
    db.storageDownload.mockResolvedValueOnce({ data: pdfBlob("%PDF different bytes"), error: null });
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    const result = await repo.uploadResumePdf!(resumeId, "zh", pdfFile("%PDF expected bytes", "resume.pdf", 456)).then(value => ({ value }), error => ({ error }));
    expect(db.storageDownload).toHaveBeenCalledOnce();
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("Mismatched candidate unexpectedly resolved");
    expect(result.error).toMatchObject({ uncertain: true });
    expect(db.storageUpload).toHaveBeenCalledOnce();
    expect(db.storageDownload).toHaveBeenCalledOnce();
    expect(db.storageRemove).not.toHaveBeenCalled();
    expect(db.storageDownload.mock.calls[0]).toEqual([expect.stringMatching(new RegExp(`^${resumeId}/zh/[0-9a-f-]{36}\\.pdf$`, "i")), {}, { cache: "no-store" }]);
  });
  it("refuses to reuse a pending legacy candidate for changed file bytes", async () => {
    stubLegacyCryptoWithoutUuid();
    const db = database();
    db.storageUpload.mockResolvedValueOnce({ error: new Error("candidate response lost") });
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    const original = pdfFile("%PDF original", "resume.pdf", 456);
    const changed = pdfFile("%PDF changed", "resume.pdf", 456);
    await expect(repo.uploadResumePdf!(resumeId, "zh", original)).rejects.toThrow(/candidate identity is retained/i);
    const originalPath = db.storageUpload.mock.calls[0]?.[0];
    await expect(repo.uploadResumePdf!(resumeId, "zh", changed)).rejects.toThrow(/different file cannot reuse/i);
    expect(db.storageUpload).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(`admin-legacy-files-upload-v1:${resumeId}:zh`)).toContain(originalPath);
  });
  it("rejects corrupt or stale legacy candidate identity without uploading or replacing it", async () => {
    stubLegacyCryptoWithoutUuid();
    const db = database();
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    const key = `admin-legacy-files-upload-v1:${resumeId}:zh`;
    const corrupt = "not-json";
    window.sessionStorage.setItem(key, corrupt);
    await expect(repo.uploadResumePdf!(resumeId, "zh", pdfFile("%PDF same", "same.pdf", 456))).rejects.toThrow(/candidate identity/i);
    expect(window.sessionStorage.getItem(key)).toBe(corrupt);
    expect(db.storageUpload).not.toHaveBeenCalled();

    window.sessionStorage.setItem(key, JSON.stringify({ resumeId, locale: "en", path: `${resumeId}/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`,
      digest: "0".repeat(64), fileName: "same.pdf", fileSize: 10, fileLastModified: 456 }));
    await expect(repo.uploadResumePdf!(resumeId, "zh", pdfFile("%PDF same", "same.pdf", 456))).rejects.toThrow(/candidate identity/i);
    expect(db.storageUpload).not.toHaveBeenCalled();
  });
  it("bounds legacy file-read preflight and issues no Storage upload after a late resolution", async () => {
    vi.useFakeTimers();
    let resolveRead!: (value: ArrayBuffer) => void;
    const read = new Promise<ArrayBuffer>(resolve => { resolveRead = resolve; });
    const db = database();
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    const file = pdfFile("%PDF delayed", "delayed.pdf");
    Object.defineProperty(file, "arrayBuffer", { configurable: true, value: () => read });
    const operation = createFilesSaveOperation();
    const upload = repo.uploadResumePdf!(resumeId, "zh", file, operation);
    const timedOut = expect(upload).rejects.toThrow(/file read timed out before a Storage request was issued/i);
    await vi.advanceTimersByTimeAsync(15_000);
    await timedOut;
    expect(operation.isActive()).toBe(false);
    expect(db.storageUpload).not.toHaveBeenCalled();
    resolveRead(new TextEncoder().encode("%PDF delayed").buffer);
    await Promise.resolve(); await Promise.resolve();
    expect(db.storageUpload).not.toHaveBeenCalled();
  });
  it("bounds an issued legacy upload and reuses its persisted candidate for deliberate same-file recovery", async () => {
    stubLegacyCryptoWithoutUuid();
    vi.useFakeTimers();
    let resolveFirst!: (value: { error: Error | null }) => void;
    const firstUpload = new Promise<{ error: Error | null }>(resolve => { resolveFirst = resolve; });
    const db = database();
    db.storageUpload.mockImplementationOnce(() => firstUpload);
    db.storageUpload.mockResolvedValueOnce({ error: new Error("candidate already exists") });
    const file = pdfFile("%PDF stable retry", "stable.pdf", 789);
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    const operation = createFilesSaveOperation();
    const first = repo.uploadResumePdf!(resumeId, "zh", file, operation);
    for (let attempt = 0; attempt < 30 && !db.storageUpload.mock.calls.length; attempt += 1) await Promise.resolve();
    expect(db.storageUpload).toHaveBeenCalledOnce();
    const firstPath = db.storageUpload.mock.calls[0]?.[0];
    const firstRejected = expect(first).rejects.toMatchObject({ uncertain: true });
    await vi.advanceTimersByTimeAsync(60_000);
    await firstRejected;
    expect(operation.isActive()).toBe(false);
    expect(window.sessionStorage.getItem(`admin-legacy-files-upload-v1:${resumeId}:zh`)).toContain(firstPath);
    resolveFirst({ error: null });
    db.storageDownload.mockResolvedValueOnce({ data: pdfBlob("%PDF stable retry"), error: null });
    const retry = await repo.uploadResumePdf!(resumeId, "zh", file, createFilesSaveOperation());
    expect(db.storageUpload).toHaveBeenCalledTimes(2);
    expect(db.storageUpload.mock.calls.map(([path]) => path)).toEqual([firstPath, firstPath]);
    expect(retry).toContain(firstPath);
  });
  it("distinguishes managed PDF deletion, already absent, not managed, and still referenced", async () => {
    const db = database(); const repo = createResumeRepository(db.client, "https://storage.example.test");
    const ref = `https://storage.example.test/storage/v1/object/public/resume-files/${resumeId}/zh/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
    await expect(repo.deleteManagedResumePdf!(resumeId, "zh", ref)).resolves.toBe("deleted");
    db.storageRemove.mockResolvedValueOnce({ data: [], error: null });
    await expect(repo.deleteManagedResumePdf!(resumeId, "zh", ref)).resolves.toBe("already-absent");
    await expect(repo.deleteManagedResumePdf!(resumeId, "zh", "https://legacy.example.test/resume.pdf")).resolves.toBe("not-managed");
    db.setLocaleRows([{ portfolio_href: ref }, { portfolio_href: "" }]);
    await expect(repo.deleteManagedResumePdf!(resumeId, "zh", ref)).resolves.toBe("still-referenced");
    expect(db.storageRemove).toHaveBeenCalledTimes(2);
  });

  it("reports an unverified reference read and failed Storage removal distinctly", async () => {
    const db = database(); const repo = createResumeRepository(db.client, "https://storage.example.test");
    const ref = `https://storage.example.test/storage/v1/object/public/resume-files/${resumeId}/en/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
    db.setLocaleReadError(new Error("read failed"));
    await expect(repo.deleteManagedResumePdf!(resumeId, "en", ref)).resolves.toBe("unverified");
    db.setLocaleReadError(null); db.storageRemove.mockResolvedValueOnce({ data: [], error: new Error("delete failed") });
    await expect(repo.deleteManagedResumePdf!(resumeId, "en", ref)).resolves.toBe("failed");
  });
  it("bounds legacy cleanup reference preflight and fences late deletion", async () => {
    vi.useFakeTimers();
    let resolveRows!: (value: { data: Array<{ portfolio_href: string }>; error: null }) => void;
    const read = new Promise<{ data: Array<{ portfolio_href: string }>; error: null }>(resolve => { resolveRows = resolve; });
    const remove = vi.fn(async () => ({ data: [{}], error: null }));
    const query = { select: () => query, eq: () => query, in: () => query, then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => read.then(resolve, reject) };
    const client = { from: vi.fn(() => query), storage: { from: vi.fn(() => ({ remove })) } } as unknown as SupabaseClient;
    const repo = createResumeRepository(client, "https://storage.example.test");
    const operation = createFilesSaveOperation();
    const ref = `https://storage.example.test/storage/v1/object/public/resume-files/${resumeId}/zh/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
    const cleanup = repo.deleteManagedResumePdf!(resumeId, "zh", ref, operation);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(cleanup).resolves.toBe("unverified");
    expect(operation.isActive()).toBe(false);
    resolveRows({ data: [{ portfolio_href: "" }, { portfolio_href: "" }], error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(remove).not.toHaveBeenCalled();
  });
  it("bounds an issued legacy cleanup as uncertain without replaying deletion", async () => {
    vi.useFakeTimers();
    let resolveRemove!: (value: { data: unknown[]; error: null }) => void;
    const removing = new Promise<{ data: unknown[]; error: null }>(resolve => { resolveRemove = resolve; });
    const remove = vi.fn(() => removing);
    const query = { select: () => query, eq: () => query, in: () => query, then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: [{ portfolio_href: "" }, { portfolio_href: "" }], error: null }).then(resolve, reject) };
    const client = { from: vi.fn(() => query), storage: { from: vi.fn(() => ({ remove })) } } as unknown as SupabaseClient;
    const repo = createResumeRepository(client, "https://storage.example.test");
    const operation = createFilesSaveOperation();
    const ref = `https://storage.example.test/storage/v1/object/public/resume-files/${resumeId}/zh/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
    const cleanup = repo.deleteManagedResumePdf!(resumeId, "zh", ref, operation);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve(); await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(cleanup).resolves.toBe("unverified");
    expect(operation.isActive()).toBe(false);
    resolveRemove({ data: [{}], error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
  });
});
