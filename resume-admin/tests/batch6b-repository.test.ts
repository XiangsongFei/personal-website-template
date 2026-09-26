import { describe, expect, it, vi } from "vitest";
import { createResumeRepository } from "../src/data/resumeRepository";
import type { SupabaseClient } from "@supabase/supabase-js";

const resumeId = "resume-id";
const projectId = "project-id";
const methodId = "method-id";
function database() {
  const calls: Array<{ table: string; op: string; payload?: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const storageUpload = vi.fn(async (_path: string, _file: File, _options?: Record<string, unknown>): Promise<{ error: Error | null }> => {
    void _path; void _file; void _options;
    return { error: null };
  });
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://storage.example.test/${path}` } }));
  const storageFrom = vi.fn(() => ({ upload: storageUpload, getPublicUrl }));
  const from = vi.fn((table: string) => {
    const call = { table, op: "select", filters: [] as Array<[string, unknown]>, payload: undefined as Record<string, unknown> | undefined };
    calls.push(call);
    const q: Record<string, (...args: never[]) => unknown> = {};
    q.insert = ((payload: Record<string, unknown>) => { call.op = "insert"; call.payload = payload; return q; }) as never;
    q.update = ((payload: Record<string, unknown>) => { call.op = "update"; call.payload = payload; return q; }) as never;
    q.delete = (() => { call.op = "delete"; return q; }) as never;
    q.select = (() => q) as never;
    q.eq = ((key: string, value: unknown) => { call.filters.push([key, value]); return q; }) as never;
    const response = () => {
      if (table === "resume_project_methods") return { id: methodId, resume_id: resumeId, project_entry_id: projectId, locale: call.payload?.locale ?? call.filters.find(([key]) => key === "locale")?.[1] ?? "zh", position: call.payload?.position ?? 0, value: call.payload?.value ?? "method", ...(call.payload ?? {}) };
      if (table === "resume_project_entries") return { id: projectId, resume_id: resumeId, position: 0, source_key: null, ...(call.payload ?? {}) };
      if (table === "resume_contact_focus_items") return { id: projectId, resume_id: resumeId, position: 0, ...(call.payload ?? {}) };
      if (table === "resume_contact_status_items") return { id: projectId, resume_id: resumeId, position: 0, status_type: "study", ...(call.payload ?? {}) };
      if (table === "resume_navigation_item_translations") return { resume_id: resumeId, navigation_item_id: "nav-id", locale: "zh", label: "中文", ...(call.payload ?? {}) };
      if (table === "resume_public_links") return { resume_id: resumeId };
      if (table === "resume_locale_content") return { resume_id: resumeId, locale: "en", ...(call.payload ?? {}) };
      return { resume_id: resumeId, project_entry_id: projectId, locale: "zh", title: "title", subtitle: "subtitle", period: "period", description: "description", href: "/", ...(call.payload ?? {}) };
    };
    q.single = (async () => ({ data: response(), error: null })) as never;
    q.maybeSingle = (async () => ({ data: response(), error: null })) as never;
    q.then = ((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: response(), error: null }).then(resolve, reject)) as never;
    return q;
  });
  return { client: { from, storage: { from: storageFrom } } as unknown as SupabaseClient, calls, storageUpload, getPublicUrl, storageFrom };
}

describe("Batch 6B scoped repository writes", () => {
  it("uploads validated profile photos to unique non-overwriting paths in profile-images", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    const first = new File(["photo"], "portrait.webp", { type: "image/webp" });
    const second = new File(["photo2"], "portrait.webp", { type: "image/webp" });
    const firstUrl = await repo.uploadProfilePhoto!(first);
    await repo.uploadProfilePhoto!(second);
    expect(db.storageFrom).toHaveBeenCalledWith("profile-images");
    const paths = db.storageUpload.mock.calls.map(call => call[0]);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(/^example-cv\/profile\/[0-9a-f-]{36}\.webp$/i);
    expect(paths[1]).not.toBe(paths[0]);
    expect(db.storageUpload).toHaveBeenNthCalledWith(1, paths[0], first, { upsert: false, contentType: "image/webp", cacheControl: "31536000" });
    expect(db.getPublicUrl).toHaveBeenCalledWith(paths[1]);
    expect(firstUrl).toBe(`https://storage.example.test/${paths[0]}`);
  });
  it("accepts only JPEG, PNG, and WebP up to 5 MB before contacting Storage", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      await expect(repo.uploadProfilePhoto!(new File(["image"], "photo", { type }))).resolves.toMatch(/storage\.example\.test/);
    }
    await expect(repo.uploadProfilePhoto!(new File(["svg"], "photo.svg", { type: "image/svg+xml" }))).rejects.toThrow("JPG, PNG, or WebP");
    const tooLarge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    await expect(repo.uploadProfilePhoto!(tooLarge)).rejects.toThrow("5 MB or smaller");
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
  it("keeps status type on parent insertion and forbids Chinese availability writes", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await repo.insertStatus!(resumeId, 0, "graduation");
    expect(db.calls[0]).toEqual({ table: "resume_contact_status_items", op: "insert", payload: { resume_id: resumeId, position: 0, status_type: "graduation" }, filters: [] });
    await expect(repo.updateContactAvailability!(resumeId, "zh", "not allowed")).rejects.toThrow("Chinese availability remains read-only");
    expect(db.calls).toHaveLength(1);
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
  it.each([
    ["zh", "example-cv/resume_zh.pdf"],
    ["en", "example-cv/resume_en.pdf"],
  ] as const)("uploads the %s PDF to its stable public bucket path with replacement enabled", async (locale, path) => {
    const db = database(); const repo = createResumeRepository(db.client);
    const file = new File(["%PDF-1.7 test"], `resume-${locale}.pdf`, { type: "application/pdf" });
    await expect(repo.uploadResumePdf!(locale, file)).resolves.toBe(`https://storage.example.test/${path}`);
    expect(db.storageFrom).toHaveBeenCalledWith("resume-files");
    expect(db.storageUpload).toHaveBeenCalledWith(path, file, { upsert: true, contentType: "application/pdf" });
    expect(db.getPublicUrl).toHaveBeenCalledWith(path);
  });
  it("rejects invalid PDF files and files above 10 MB before contacting Storage", async () => {
    const db = database(); const repo = createResumeRepository(db.client);
    await expect(repo.uploadResumePdf!("zh", new File(["not pdf"], "bad.txt", { type: "text/plain" }))).rejects.toThrow("Resume PDF must be a PDF file.");
    const tooLarge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });
    await expect(repo.uploadResumePdf!("en", tooLarge)).rejects.toThrow("Resume PDF must be 10 MB or smaller.");
    expect(db.storageUpload).not.toHaveBeenCalled();
  });
  it("does not claim success when the Storage upload fails", async () => {
    const db = database(); db.storageUpload.mockResolvedValueOnce({ error: new Error("storage unavailable") });
    const repo = createResumeRepository(db.client);
    await expect(repo.uploadResumePdf!("zh", new File(["pdf"], "resume.pdf", { type: "application/pdf" }))).rejects.toThrow("Resume PDF upload failed.");
    expect(db.getPublicUrl).not.toHaveBeenCalled();
  });
});
