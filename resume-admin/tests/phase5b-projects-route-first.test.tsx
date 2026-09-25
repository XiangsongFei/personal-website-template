import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { mapProjectRows } from "../src/data/resumeMapper";
import { createResumeRepository, type ResumeRepository, type ResumeSectionRepository } from "../src/data/resumeRepository";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "projects-resume-id";
const projects = structuredClone(fixtureSections.projects);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function auth(): AdminAuthClient {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin", email: "admin@example.test", sessionKey: "projects-session" }),
    isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(async () => listener?.("SIGNED_OUT", null)),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }) };
}
function repository(overrides: Partial<ResumeSectionRepository> = {}) {
  return {
    load: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) }),
    loadSiteMetadata: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null }),
    loadOverview: vi.fn().mockResolvedValue({ profileName: "Example" }),
    loadProfile: vi.fn().mockResolvedValue(fixtureSections.profile),
    loadIntroduction: vi.fn().mockResolvedValue(fixtureSections.introduction),
    loadEducation: vi.fn().mockResolvedValue(fixtureSections.education),
    loadExperience: vi.fn().mockResolvedValue(fixtureSections.experience),
    loadProjects: vi.fn().mockResolvedValue(structuredClone(projects)),
    loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards),
    loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(fixtureSections.links),
    updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    ...overrides,
  };
}
function show(repo: ResumeRepository, path = "/projects", store = new ResumeSectionStore(), strict = false) {
  const client = auth();
  const app = <UiLocaleProvider><MemoryRouter initialEntries={[path]}><AuthGate client={client} resumeRepository={repo} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), store };
}
const go = (label: string) => fireEvent.click(screen.getByRole("link", { name: label }));
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Phase 5B Projects route-first loading", () => {
  it("cold /projects reads only site, project parents, translations, and methods", async () => {
    const reads: string[] = [];
    const rows: Record<string, Record<string, unknown>[]> = {
      resume_project_entries: [
        { id: "project-b", resume_id: resumeId, position: 1, source_key: "b-key" },
        { id: "project-a", resume_id: resumeId, position: 0, source_key: "a-key" },
      ],
      resume_project_translations: ["project-a", "project-b"].flatMap(project_entry_id => (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, project_entry_id, locale, title: `${project_entry_id}-${locale}`, subtitle: "subtitle", period: "period", description: "description", href: "" }))),
      resume_project_methods: [
        { id: "a-en-1", resume_id: resumeId, project_entry_id: "project-a", locale: "en", position: 1, value: "A English second" },
        { id: "b-zh-0", resume_id: resumeId, project_entry_id: "project-b", locale: "zh", position: 0, value: "B Chinese" },
        { id: "a-zh-0", resume_id: resumeId, project_entry_id: "project-a", locale: "zh", position: 0, value: "A 中文" },
        { id: "a-en-0", resume_id: resumeId, project_entry_id: "project-a", locale: "en", position: 0, value: "A English first" },
      ],
    };
    const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
      reads.push(table);
      if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: true, updated_at: null }, error: null }) };
      if (table in rows) return Promise.resolve({ data: rows[table], error: null });
      throw new Error(`Unexpected table read ${table}`);
    }) })), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const full = vi.spyOn(repo, "load");
    show(repo, "/projects", new ResumeSectionStore(), true);
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    expect(reads).toEqual(["resume_sites", "resume_project_entries", "resume_project_translations", "resume_project_methods"]);
    expect(full).not.toHaveBeenCalled();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    const mapped = await repo.loadProjects(resumeId);
    expect(mapped.map(item => [item.id, item.position, item.sourceKey])).toEqual([["project-a", 0, "a-key"], ["project-b", 1, "b-key"]]);
    expect(mapped[0].methods.zh.map(method => [method.id, method.position, method.value])).toEqual([["a-zh-0", 0, "A 中文"]]);
    expect(mapped[0].methods.en.map(method => [method.id, method.position, method.value])).toEqual([["a-en-0", 0, "A English first"], ["a-en-1", 1, "A English second"]]);
    expect(mapped[1].methods.zh.map(method => method.value)).toEqual(["B Chinese"]);
    expect(mapped[1].methods.en).toEqual([]);
    expect(mapped[0].translations.zh.title).toBe("project-a-zh");
    expect(mapped[0].translations.en.title).toBe("project-a-en");
  });

  it("shows localized loading/error and retries Projects only while shell stays mounted", async () => {
    for (const locale of ["en", "zh"] as const) {
      cleanup(); window.localStorage.setItem(UI_LOCALE_KEY, locale);
      const pending = deferred<typeof projects>(); void pending.promise.catch(() => {});
      const repo = repository({ loadProjects: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(structuredClone(projects)) });
      show(repo);
      expect(await screen.findByRole("navigation", { name: locale === "en" ? "CMS sections" : "CMS 模块" })).toBeTruthy();
      expect(screen.getByRole("banner")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(locale === "en" ? "Loading Projects..." : "正在加载项目经历……");
      expect(screen.queryByRole("heading", { name: "Loading resume content…" })).toBeNull();
      pending.reject(new Error("methods or project read failed"));
      expect((await screen.findByRole("alert")).textContent).toContain(locale === "en" ? "Unable to load Projects." : "无法加载项目经历。");
      fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重试" }));
      expect(await screen.findByLabelText(locale === "en" ? "English Title" : "英文 标题")).toBeTruthy();
      expect(repo.loadProjects).toHaveBeenCalledTimes(2);
      expect(repo.load).not.toHaveBeenCalled();
      expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
      for (const other of ["loadProfile", "loadIntroduction", "loadEducation", "loadExperience", "loadSkills", "loadAwards", "loadContact", "loadLinks"] as const) expect(repo[other]).not.toHaveBeenCalled();
    }
  });

  it("coalesces, reuses cache and site metadata, and keeps dirty editor state through route-first Overview navigation", async () => {
    const read = deferred<typeof projects>(); void read.promise.catch(() => {});
    const repo = repository({ loadProjects: vi.fn().mockReturnValue(read.promise) });
    const { store } = show(repo);
    await screen.findByRole("status");
    await waitFor(() => expect(repo.loadProjects).toHaveBeenCalledOnce());
    read.resolve(structuredClone(projects));
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    expect(store.getSectionState("projects-session", resumeId, "projects").status).toBe("loaded");
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Dirty after local save" } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Unsaved project title" } });
    go("Skills"); expect(await screen.findByLabelText("English Group title")).toBeTruthy();
    expect(repo.load).not.toHaveBeenCalled();
    go("Projects"); expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Unsaved project title");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByLabelText("英文 标题")).toBeTruthy();
    go("荣誉奖项"); expect(await screen.findByLabelText("英文 荣誉名称")).toBeTruthy();
    go("项目经历"); expect((screen.getByLabelText("英文 标题") as HTMLInputElement).value).toBe("Unsaved project title");
    expect(repo.loadProjects).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    go("概览"); expect(await screen.findByRole("heading", { name: "概览" })).toBeTruthy();
    await waitFor(() => expect(repo.loadOverview).toHaveBeenCalledOnce());
    expect(repo.load).not.toHaveBeenCalled();
    go("项目经历");
    expect((screen.getByLabelText("英文 标题") as HTMLInputElement).value).toBe("Unsaved project title");
    expect(repo.loadProjects).toHaveBeenCalledOnce();
  });

  it("reuses site metadata from another migrated route without prefetching other content", async () => {
    const repo = repository();
    show(repo, "/skills");
    expect(await screen.findByLabelText("English Group title")).toBeTruthy();
    go("Projects");
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.loadProjects).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    for (const other of ["loadIntroduction", "loadEducation", "loadExperience", "loadAwards", "loadContact", "loadLinks"] as const) expect(repo[other]).not.toHaveBeenCalled();
  });

  it("keeps empty methods valid and keeps every method within its project and locale", () => {
    const mapped = mapProjectRows([
      { id: "A", resume_id: resumeId, position: 0, source_key: null },
      { id: "B", resume_id: resumeId, position: 1, source_key: null },
    ], ["A", "B"].flatMap(project_entry_id => (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, project_entry_id, locale, title: `${project_entry_id}-${locale}`, subtitle: "", period: "", description: "", href: "" }))), [
      { id: "A-zh", resume_id: resumeId, project_entry_id: "A", locale: "zh", position: 0, value: "A中文" },
      { id: "A-en", resume_id: resumeId, project_entry_id: "A", locale: "en", position: 0, value: "A English" },
      { id: "B-en", resume_id: resumeId, project_entry_id: "B", locale: "en", position: 0, value: "B English" },
    ], resumeId);
    expect(mapped[0].methods.zh.map(item => item.value)).toEqual(["A中文"]);
    expect(mapped[0].methods.en.map(item => item.value)).toEqual(["A English"]);
    expect(mapped[1].methods.zh).toEqual([]);
    expect(mapped[1].methods.en.map(item => item.value)).toEqual(["B English"]);
  });

  it("invalidates Projects cache and keeps Overview route-first", async () => {
    const store = new ResumeSectionStore();
    const repo = repository();
    show(repo, "/projects", store);
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    expect(store.getSectionState("projects-session", resumeId, "projects").status).toBe("loaded");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(store.getSectionState("projects-session", resumeId, "projects").status).toBe("idle");
    for (const path of ["/overview"]) {
      cleanup(); const next = repository();
      show(next, path);
      await waitFor(() => expect(next.loadOverview).toHaveBeenCalledOnce());
      expect(next.load).not.toHaveBeenCalled();
      expect(next.loadProjects).not.toHaveBeenCalled();
    }
  });
});
