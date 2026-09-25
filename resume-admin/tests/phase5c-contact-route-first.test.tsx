import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { createResumeRepository, type ResumeRepository, type ResumeSectionRepository } from "../src/data/resumeRepository";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "contact-resume-id";
const contact = structuredClone(fixtureSections.contact);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function auth(): AdminAuthClient { let listener: ((event: string, key: string | null) => void) | undefined; return {
  getIdentity: vi.fn().mockResolvedValue({ id: "admin", email: "admin@example.test", sessionKey: "contact-session" }), isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(),
  signOut: vi.fn(async () => listener?.("SIGNED_OUT", null)), subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }),
}; }
function repository(overrides: Partial<ResumeSectionRepository> = {}) { return {
  load: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) }),
  loadSiteMetadata: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null }),
  loadOverview: vi.fn().mockResolvedValue({ profileName: "Example" }), loadProfile: vi.fn().mockResolvedValue(fixtureSections.profile),
  loadIntroduction: vi.fn().mockResolvedValue(fixtureSections.introduction), loadEducation: vi.fn().mockResolvedValue(fixtureSections.education),
  loadExperience: vi.fn().mockResolvedValue(fixtureSections.experience), loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects),
  loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills), loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards),
  loadContact: vi.fn().mockResolvedValue(structuredClone(contact)), loadLinks: vi.fn().mockResolvedValue(fixtureSections.links),
  updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(), ...overrides,
}; }
function show(repo: ResumeRepository, path = "/contact", store = new ResumeSectionStore(), strict = false) {
  const app = <UiLocaleProvider><MemoryRouter initialEntries={[path]}><AuthGate client={auth()} resumeRepository={repo} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), store };
}
const go = (name: string) => fireEvent.click(screen.getAllByRole("link", { name })[0]);
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Phase 5C Contact route-first loading", () => {
  it("cold /contact reads only its six required tables and no full snapshot", async () => {
    const reads: string[] = [];
    const shared = (locale: "zh" | "en") => ({ resume_id: resumeId, locale, contact_label: `${locale} contact`, availability: `${locale} availability` });
    const tables: Record<string, Record<string, unknown>[]> = {
      resume_locale_content: [shared("zh"), shared("en")],
      resume_contact_focus_items: [{ id: "focus-b", resume_id: resumeId, position: 1 }, { id: "focus-a", resume_id: resumeId, position: 0 }],
      resume_contact_focus_translations: ["focus-a", "focus-b"].flatMap(focus_item_id => (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, focus_item_id, locale, title: `${focus_item_id}-${locale}`, detail: `${locale} detail` }))),
      resume_contact_status_items: [{ id: "status-b", resume_id: resumeId, position: 1, status_type: "open" }, { id: "status-a", resume_id: resumeId, position: 0, status_type: "study" }],
      resume_contact_status_translations: ["status-a", "status-b"].flatMap(status_item_id => (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, status_item_id, locale, title: `${status_item_id}-${locale}`, detail: `${locale} status detail` }))),
    };
    const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
      reads.push(table);
      if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: true, updated_at: null }, error: null }) };
      if (table in tables) return Promise.resolve({ data: tables[table], error: null });
      throw new Error(`Unexpected table read ${table}`);
    }) })), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const full = vi.spyOn(repo, "load");
    show(repo, "/contact", new ResumeSectionStore(), true);
    expect(await screen.findByLabelText("English Section label")).toBeTruthy();
    expect(reads).toEqual(["resume_sites", "resume_locale_content", "resume_contact_focus_items", "resume_contact_focus_translations", "resume_contact_status_items", "resume_contact_status_translations"]);
    expect(full).not.toHaveBeenCalled();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    expect(screen.getByDisplayValue("focus-a-en")).toBeTruthy();
    expect(screen.getByDisplayValue("status-a-en")).toBeTruthy();
    expect((screen.getByLabelText("Status type (shared)") as HTMLSelectElement).value).toBe("study");
  });

  it("localizes loading, failure, and Contact-only retry while the shell remains mounted", async () => {
    for (const locale of ["en", "zh"] as const) {
      cleanup(); window.localStorage.setItem(UI_LOCALE_KEY, locale);
      const failed = deferred<typeof contact>(); void failed.promise.catch(() => {});
      const repo = repository({ loadContact: vi.fn().mockReturnValueOnce(failed.promise).mockResolvedValue(structuredClone(contact)) });
      show(repo);
      expect(await screen.findByRole("navigation", { name: locale === "en" ? "CMS sections" : "CMS 模块" })).toBeTruthy();
      expect(screen.getByRole("banner")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(locale === "en" ? "Loading Contact..." : "正在加载联系信息……");
      expect(screen.queryByRole("heading", { name: "Loading resume content…" })).toBeNull();
      failed.reject(new Error("contact dependency failed"));
      expect((await screen.findByRole("alert")).textContent).toContain(locale === "en" ? "Unable to load Contact." : "无法加载联系信息。");
      fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重试" }));
      expect(await screen.findByLabelText(locale === "en" ? "English Section label" : "英文 部分标签")).toBeTruthy();
      expect(repo.loadContact).toHaveBeenCalledTimes(2); expect(repo.load).not.toHaveBeenCalled(); expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
      for (const other of ["loadProfile", "loadIntroduction", "loadEducation", "loadExperience", "loadProjects", "loadSkills", "loadAwards", "loadLinks"] as const) expect(repo[other]).not.toHaveBeenCalled();
    }
  });

  it("reuses metadata and Contact cache across migrated routes and locale switching", async () => {
    const repo = repository(); const { store } = show(repo, "/projects");
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    go("Contact"); expect(await screen.findByLabelText("English Section label")).toBeTruthy();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce(); expect(repo.load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByLabelText("英文 部分标签")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    go("Projects"); expect(await screen.findByLabelText("English Title")).toBeTruthy();
    go("Contact"); expect((screen.getByLabelText("English Section label") as HTMLInputElement).value).toBe("Contact");
    expect(repo.loadContact).toHaveBeenCalledOnce(); expect(repo.loadProjects).toHaveBeenCalledOnce();
    expect(store.getSectionState("contact-session", resumeId, "links").status).toBe("idle");
    expect(store.getSectionState("contact-session", resumeId, "contact").status).toBe("loaded");
  });

  it("preserves independent locale data, missing translations, UUIDs, order, and status types", async () => {
    const { mapContactRows } = await import("../src/data/resumeMapper");
    const result = mapContactRows([
      { resume_id: resumeId, locale: "zh", contact_label: "联系", availability: "中文状态" },
      { resume_id: resumeId, locale: "en", contact_label: "Contact", availability: "English status" },
    ], [
      { id: "f2", resume_id: resumeId, position: 1 }, { id: "f1", resume_id: resumeId, position: 0 },
    ], [{ resume_id: resumeId, focus_item_id: "f1", locale: "zh", title: "关注", detail: "细节" }, { resume_id: resumeId, focus_item_id: "f1", locale: "en", title: "Focus", detail: "Detail" }], [
      { id: "s2", resume_id: resumeId, position: 1, status_type: "open" }, { id: "s1", resume_id: resumeId, position: 0, status_type: "graduation" },
    ], [{ resume_id: resumeId, status_item_id: "s1", locale: "zh", title: "毕业", detail: "中文" }, { resume_id: resumeId, status_item_id: "s1", locale: "en", title: "Graduation", detail: "English" }], resumeId);
    expect(result.translations).toEqual({ zh: { contactLabel: "联系", availability: "中文状态" }, en: { contactLabel: "Contact", availability: "English status" } });
    expect(result.focus.map(item => [item.id, item.position, item.sourceKey])).toEqual([["f1", 0, null], ["f2", 1, null]]);
    expect(result.focus[0].translations).toEqual({ zh: { title: "关注", detail: "细节" }, en: { title: "Focus", detail: "Detail" } });
    expect(result.focus[1].translations).toEqual({ zh: { title: "", detail: "" }, en: { title: "", detail: "" } });
    expect(result.status.map(item => [item.id, item.position, item.statusType])).toEqual([["s1", 0, "graduation"], ["s2", 1, "open"]]);
    expect(result.status[0].translations).toEqual({ zh: { title: "毕业", detail: "中文" }, en: { title: "Graduation", detail: "English" } });
    expect(result.status[1].translations).toEqual({ zh: { title: "", detail: "" }, en: { title: "", detail: "" } });
  });

  it("isolates failures, retries required reads, preserves drafts through route-first Overview, and keeps Overview isolated from Contact", async () => {
    const requiredTables = ["resume_locale_content", "resume_contact_focus_items", "resume_contact_focus_translations", "resume_contact_status_items", "resume_contact_status_translations"];
    for (const failedTable of requiredTables) {
      cleanup();
      const reads: string[] = []; let failed = false;
      const rows: Record<string, Record<string, unknown>[]> = {
        resume_locale_content: (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, locale, contact_label: locale, availability: locale })),
        resume_contact_focus_items: [{ id: "focus-a", resume_id: resumeId, position: 0 }],
        resume_contact_focus_translations: (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, focus_item_id: "focus-a", locale, title: locale, detail: locale })),
        resume_contact_status_items: [{ id: "status-a", resume_id: resumeId, position: 0, status_type: "open" }],
        resume_contact_status_translations: (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, status_item_id: "status-a", locale, title: locale, detail: locale })),
      };
      const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
        reads.push(table);
        if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: true, updated_at: null }, error: null }) };
        if (table === failedTable && !failed) { failed = true; return Promise.resolve({ data: null, error: new Error("temporary read failure") }); }
        return Promise.resolve({ data: rows[table], error: null });
      }) })), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
      const repo = createResumeRepository({ from } as unknown as SupabaseClient);
      const loadContact = vi.spyOn(repo, "loadContact"); const fullLoad = vi.spyOn(repo, "load");
      const store = new ResumeSectionStore(); store.setSession("contact-session");
      await store.loadSection("contact-session", resumeId, "projects", async () => structuredClone(fixtureSections.projects));
      show(repo, "/contact", store);
      await screen.findByRole("alert");
      expect(store.getSectionState("contact-session", resumeId, "projects").status).toBe("loaded");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByLabelText("English Section label")).toBeTruthy();
      expect(loadContact).toHaveBeenCalledTimes(2); expect(fullLoad).not.toHaveBeenCalled();
      expect(reads.filter(table => table === failedTable)).toHaveLength(2);
    }
    cleanup();
    const repo = repository(); show(repo); expect(await screen.findByLabelText("English Section label")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English Section label"), { target: { value: "Unsaved Contact edit" } });
    fireEvent.change(screen.getByLabelText("English Section label"), { target: { value: "Dirty Contact edit" } });
    go("Overview"); expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy(); await waitFor(() => expect(repo.loadOverview).toHaveBeenCalledOnce()); expect(repo.load).not.toHaveBeenCalled();
    go("Contact"); expect((screen.getByLabelText("English Section label") as HTMLInputElement).value).toBe("Dirty Contact edit");
    expect(repo.loadContact).toHaveBeenCalledOnce();
    for (const path of ["/overview"]) { cleanup(); const next = repository(); show(next, path); await waitFor(() => expect(next.loadOverview).toHaveBeenCalledOnce()); expect(next.load).not.toHaveBeenCalled(); expect(next.loadContact).not.toHaveBeenCalled(); }
  });

  it("invalidates Contact cache on sign-out and keeps locale content owned by the Contact cache only", async () => {
    const store = new ResumeSectionStore(); const repo = repository(); show(repo, "/contact", store);
    expect(await screen.findByLabelText("English Section label")).toBeTruthy();
    expect(store.getSectionState("contact-session", resumeId, "contact").status).toBe("loaded");
    expect(store.getSectionState("contact-session", resumeId, "links").status).toBe("idle");
    store.setSession("changed-session");
    expect(store.getSectionState("contact-session", resumeId, "contact").status).toBe("idle");
    expect(store.getSectionState("changed-session", resumeId, "contact").status).toBe("idle");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(store.getSectionState("contact-session", resumeId, "contact").status).toBe("idle");
  });
});
