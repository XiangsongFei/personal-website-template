import { describe, expect, it, vi } from "vitest";
import { createResumeRepository } from "../src/data/resumeRepository";
import type { SupabaseClient } from "@supabase/supabase-js";

const resumeId = "11111111-1111-4111-8111-111111111111";
const projectId = "project-id";
const methodId = "method-id";
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
  const storageRemove = vi.fn(async (_paths: string[]): Promise<{ data: unknown[]; error: Error | null }> => {
    void _paths;
    return { data: [{}], error: null };
  });
  const getPublicUrl = vi.fn((path: string, bucket = "profile-images") => ({ data: { publicUrl: bucket === "resume-files"
    ? `https://storage.example.test/storage/v1/object/public/${bucket}/${path}` : `https://storage.example.test/${path}` } }));
  const storageFrom = vi.fn((bucket = "profile-images") => ({ upload: storageUpload, info: storageInfo, remove: storageRemove, getPublicUrl: (path: string) => getPublicUrl(path, bucket) }));
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
  return { client: { from, storage: { from: storageFrom }, supabaseUrl: "https://storage.example.test" } as unknown as SupabaseClient, calls, storageUpload, storageInfo, storageRemove, getPublicUrl, storageFrom,
    setLocaleRows(rows: Array<{ portfolio_href: string }>) { localeRows = rows; }, setLocaleReadError(error: Error | null) { localeReadError = error; } };
}

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
    const db = database(); const repo = createResumeRepository(db.client, "https://storage.example.test");
    const file = new File(["%PDF-1.7 test"], `resume-${locale}.pdf`, { type: "application/pdf" });
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
  it("uses a distinct candidate path for every replacement instead of overwriting the prior object", async () => {
    const db = database();
    const repo = createResumeRepository(db.client, "https://storage.example.test");
    const file = new File(["%PDF replacement"], "replacement.pdf", { type: "application/pdf" });

    const first = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));
    const second = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));
    expect(first.pathname).not.toBe(second.pathname);
    expect(first.search).toBe(""); expect(first.hash).toBe("");
    expect(db.storageUpload).toHaveBeenCalledTimes(2);
    expect(db.storageUpload.mock.calls.every(([path]) => path.startsWith(`${resumeId}/zh/`))).toBe(true);
    expect(db.storageUpload.mock.calls.every(([, , options]) => options?.upsert === false)).toBe(true);
  });
  it("uses distinct UUID-shaped candidate paths when crypto.randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    try {
      const db = database();
      db.storageUpload.mockResolvedValueOnce({ error: new Error("temporary storage failure") });
      const repo = createResumeRepository(db.client, "https://storage.example.test");
      const file = new File(["%PDF test"], "费湘淞_中文简历.pdf", { type: "application/pdf" });

      await expect(repo.uploadResumePdf!(resumeId, "zh", file)).rejects.toThrow("Resume PDF upload failed.");
      const firstRetryUrl = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));
      const secondSuccessUrl = new URL(await repo.uploadResumePdf!(resumeId, "zh", file));

      expect(db.storageFrom).toHaveBeenCalledWith("resume-files");
      expect(db.storageUpload).toHaveBeenCalledTimes(3);
      const paths = db.storageUpload.mock.calls.map(([path]) => path);
      expect(paths).toHaveLength(3);
      expect(paths.every(path => new RegExp(`^${resumeId}/zh/[0-9a-f-]{36}\\.pdf$`).test(path))).toBe(true);
      expect(new Set(paths).size).toBe(3);
      expect(db.storageUpload.mock.calls.every(([, , options]) => options?.upsert === false)).toBe(true);
      expect(firstRetryUrl.pathname).not.toBe(secondSuccessUrl.pathname);
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
    await expect(repo.uploadResumePdf!(resumeId, "zh", new File(["pdf"], "resume.pdf", { type: "application/pdf" }))).rejects.toThrow("Resume PDF upload failed.");
    expect(db.getPublicUrl).not.toHaveBeenCalled();
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
});
