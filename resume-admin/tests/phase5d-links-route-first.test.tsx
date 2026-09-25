import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { createResumeRepository, type ResumeRepository, type ResumeSectionRepository } from "../src/data/resumeRepository";
import { mapLinksRows } from "../src/data/resumeMapper";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "links-resume-id";
const links = structuredClone(fixtureSections.links);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function auth(): AdminAuthClient {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin", email: "admin@example.test", sessionKey: "links-session" }),
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
    loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects),
    loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards),
    loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(structuredClone(links)),
    updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(), ...overrides,
  };
}
function show(repo: ResumeRepository, path = "/links", store = new ResumeSectionStore(), strict = false) {
  const app = <UiLocaleProvider><MemoryRouter initialEntries={[path]}><AuthGate client={auth()} resumeRepository={repo} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), store };
}
const go = (label: string) => fireEvent.click(screen.getAllByRole("link", { name: label })[0]);
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Phase 5D Links route-first loading", () => {
  it("cold /links reads only the actual Links schema tables and maps public links without an id", async () => {
    const reads: string[] = [];
    const navigationRows = [
      { id: "nav-5", resume_id: resumeId, source_key: "contact-key", position: 4 },
      { id: "nav-2", resume_id: resumeId, source_key: "education-key", position: 1 },
      { id: "nav-4", resume_id: resumeId, source_key: "projects-key", position: 3 },
      { id: "nav-1", resume_id: resumeId, source_key: "about-key", position: 0 },
      { id: "nav-3", resume_id: resumeId, source_key: "experience-key", position: 2 },
    ];
    const rows: Record<string, Record<string, unknown>[]> = {
      resume_public_links: [{ resume_id: resumeId, email: "a@example.test", github: "https://github.test/a", github_label: "GitHub", linkedin_display_name: "Name", email_label: "Email", linkedin_label: "LinkedIn" }],
      resume_locale_content: [
        { resume_id: resumeId, locale: "zh", education_label: "教育", experience_label: "经历", project_heading: "项目", skills_label: "技能", honors_label: "荣誉", portfolio_label: "中文 PDF", portfolio_href: "/zh.pdf", kaggle_label: "Kaggle 中", updated_at_label: "更新中", linkedin_label: "领英中", linkedin_href: "https://zh.test" },
        { resume_id: resumeId, locale: "en", education_label: "Education", experience_label: "Experience", project_heading: "Projects", skills_label: "Skills", honors_label: "Awards", portfolio_label: "English PDF", portfolio_href: "/en.pdf", kaggle_label: "Kaggle EN", updated_at_label: "Updated", linkedin_label: "LinkedIn EN", linkedin_href: "https://en.test" },
      ],
      resume_navigation_items: navigationRows,
      resume_navigation_item_translations: navigationRows.flatMap(row => (["zh", "en"] as const).map(locale => ({
        resume_id: resumeId, navigation_item_id: row.id, locale, label: `${row.source_key}-${locale}`,
      }))),
    };
    const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
      reads.push(table);
      if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: true, updated_at: null }, error: null }) };
      if (table in rows) return Promise.resolve({ data: rows[table], error: null });
      throw new Error(`Unexpected table read ${table}`);
    }) })), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const full = vi.spyOn(repo, "load");
    show(repo, "/links", new ResumeSectionStore(), true);
    expect(await screen.findByLabelText("GitHub URL")).toBeTruthy();
    expect(reads).toEqual(["resume_sites", "resume_public_links", "resume_locale_content", "resume_navigation_items", "resume_navigation_item_translations"]);
    expect(full).not.toHaveBeenCalled();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    const mapped = await repo.loadLinks(resumeId);
    expect(mapped.shared).toEqual({ email: "a@example.test", github: "https://github.test/a", githubLabel: "GitHub", linkedInDisplayName: "Name", emailLabel: "Email", linkedInLabel: "LinkedIn" });
    expect(mapped.translations.zh.portfolioLabel).toBe("中文 PDF");
    expect(mapped.translations.en.portfolioLabel).toBe("English PDF");
    expect(mapped.translations.zh.linkedInHref).toBe("https://zh.test");
    expect(mapped.translations.en.linkedInHref).toBe("https://en.test");
    expect(mapped.navigation.map(item => [item.id, item.sourceKey, item.position, item.sectionId])).toEqual([
      ["nav-1", "about-key", 0, "experience"], ["nav-2", "education-key", 1, "projects"], ["nav-3", "experience-key", 2, "skills"],
      ["nav-4", "projects-key", 3, "awards"], ["nav-5", "contact-key", 4, "contact"],
    ]);
    expect(mapped.navigation[0].translations).toEqual({ zh: { label: "about-key-zh" }, en: { label: "about-key-en" } });
    expect("id" in rows.resume_public_links[0]).toBe(false);
    expect(["resume_profile", "resume_intro_paragraphs", "resume_education_entries", "resume_experience_entries", "resume_project_entries", "resume_skill_groups", "resume_award_entries", "resume_contact_focus_items", "resume_contact_status_items"].some(table => reads.includes(table))).toBe(false);
  });

  it("shows localized loading/error and retries only Links while the authenticated shell stays mounted", async () => {
    for (const locale of ["en", "zh"] as const) {
      cleanup(); window.localStorage.setItem(UI_LOCALE_KEY, locale);
      const first = deferred<typeof links>(); void first.promise.catch(() => {});
      const repo = repository({ loadLinks: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(structuredClone(links)) });
      show(repo);
      expect(await screen.findByRole("navigation", { name: locale === "en" ? "CMS sections" : "CMS 模块" })).toBeTruthy();
      expect(screen.getByRole("banner")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(locale === "en" ? "Loading Links & Site Text..." : "正在加载链接与网站文本……");
      expect(screen.queryByRole("heading", { name: "Loading resume content…" })).toBeNull();
      first.reject(new Error("Links dependency failed"));
      expect((await screen.findByRole("alert")).textContent).toContain(locale === "en" ? "Unable to load Links & Site Text." : "无法加载链接与网站文本。");
      fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重试" }));
      expect(await screen.findByLabelText(locale === "en" ? "GitHub URL" : "GitHub URL")).toBeTruthy();
      expect(repo.loadLinks).toHaveBeenCalledTimes(2); expect(repo.load).not.toHaveBeenCalled(); expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
      for (const other of ["loadProfile", "loadIntroduction", "loadEducation", "loadExperience", "loadProjects", "loadSkills", "loadAwards", "loadContact"] as const) expect(repo[other]).not.toHaveBeenCalled();
    }
  });

  it("coalesces strict-mode loading, keeps Contacts and Links separate, and reuses metadata and Links cache", async () => {
    const store = new ResumeSectionStore();
    const repo = repository();
    show(repo, "/contact", store, true);
    expect(await screen.findByLabelText("English Section label")).toBeTruthy();
    expect(store.getSectionState("links-session", resumeId, "contact").status).toBe("loaded");
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("idle");
    go("Links & Site Text");
    expect(await screen.findByLabelText("GitHub URL")).toBeTruthy();
    expect(repo.loadLinks).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    expect(store.getSectionState("links-session", resumeId, "contact").status).toBe("loaded");
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("loaded");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByLabelText("GitHub URL")).toBeTruthy();
    fireEvent.click(document.querySelector('a[href="/contact"]')!);
    expect(await screen.findByLabelText("英文 部分标签")).toBeTruthy();
    fireEvent.click(document.querySelector('a[href="/links"]')!);
    expect(await screen.findByLabelText("GitHub URL")).toBeTruthy();
    expect(repo.loadContact).toHaveBeenCalledOnce();
    expect(repo.loadLinks).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("preserves Links and Contact drafts through each other and route-first Overview", async () => {
    const repo = repository(); show(repo);
    expect(await screen.findByLabelText("GitHub URL")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("GitHub URL"), { target: { value: "https://saved-local.example.test" } });
    expect(repo.loadLinks).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("GitHub URL"), { target: { value: "https://draft.example.test" } });
    go("Contact");
    expect(await screen.findByLabelText("English Section label")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English Section label"), { target: { value: "Dirty Contact draft" } });
    go("Links & Site Text");
    expect((screen.getByLabelText("GitHub URL") as HTMLInputElement).value).toBe("https://draft.example.test");
    go("Contact");
    expect((screen.getByLabelText("English Section label") as HTMLInputElement).value).toBe("Dirty Contact draft");
    go("Links & Site Text");
    go("Overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(repo.loadOverview).toHaveBeenCalledOnce());
    expect(repo.load).not.toHaveBeenCalled();
    go("Links & Site Text");
    expect((screen.getByLabelText("GitHub URL") as HTMLInputElement).value).toBe("https://draft.example.test");
    go("Contact");
    expect((screen.getByLabelText("English Section label") as HTMLInputElement).value).toBe("Dirty Contact draft");
    expect(repo.loadLinks).toHaveBeenCalledOnce();
    expect(repo.loadContact).toHaveBeenCalledOnce();
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("keeps missing locale values empty and makes each failed Links table read retryable without invalidating Contact", async () => {
    const missingLocale = mapLinksRows([{ resume_id: resumeId, email: "x", github: "g", github_label: "g", linkedin_display_name: "n", email_label: "e", linkedin_label: "l" }],
      [{ resume_id: resumeId, locale: "en", education_label: "Education", experience_label: "", project_heading: "", skills_label: "", honors_label: "", portfolio_label: "English only", portfolio_href: "", kaggle_label: "", updated_at_label: "", linkedin_label: "", linkedin_href: "" }],
      Array.from({ length: 5 }, (_, position) => ({ id: `n${position}`, resume_id: resumeId, source_key: `key-${position}`, position })),
      Array.from({ length: 5 }, (_, position) => ["zh", "en"].map(locale => ({ resume_id: resumeId, navigation_item_id: `n${position}`, locale, label: `${locale}-${position}` }))).flat(), resumeId);
    expect(missingLocale.translations.zh.portfolioLabel).toBe("");
    expect(missingLocale.translations.en.portfolioLabel).toBe("English only");

    const dependencies = ["resume_public_links", "resume_locale_content", "resume_navigation_items", "resume_navigation_item_translations"];
    for (const failedTable of dependencies) {
      cleanup();
      let failed = false;
      const reads: string[] = [];
      const parents = Array.from({ length: 5 }, (_, position) => ({ id: `nav-${position}`, resume_id: resumeId, source_key: `key-${position}`, position }));
      const rows: Record<string, Record<string, unknown>[]> = {
        resume_public_links: [{ resume_id: resumeId, email: "x", github: "g", github_label: "g", linkedin_display_name: "n", email_label: "e", linkedin_label: "l" }],
        resume_locale_content: (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, locale, education_label: locale, experience_label: locale, project_heading: locale, skills_label: locale, honors_label: locale, portfolio_label: locale, portfolio_href: "", kaggle_label: "", updated_at_label: locale, linkedin_label: locale, linkedin_href: "" })),
        resume_navigation_items: parents,
        resume_navigation_item_translations: parents.flatMap(parent => (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, navigation_item_id: parent.id, locale, label: `${parent.source_key}-${locale}` }))),
      };
      const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
        reads.push(table);
        if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: true, updated_at: null }, error: null }) };
        if (table === failedTable && !failed) { failed = true; return Promise.resolve({ data: null, error: new Error("injected table failure") }); }
        return Promise.resolve({ data: rows[table], error: null });
      }) })), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
      const repo = createResumeRepository({ from } as unknown as SupabaseClient);
      const full = vi.spyOn(repo, "load");
      const store = new ResumeSectionStore(); store.setSession("links-session");
      await store.loadSection("links-session", resumeId, "contact", async () => structuredClone(fixtureSections.contact));
      show(repo, "/links", store);
      await screen.findByRole("alert");
      expect(store.getSectionState("links-session", resumeId, "contact").status).toBe("loaded");
      expect(store.getSectionState("links-session", resumeId, "links").status).toBe("error");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByLabelText("GitHub URL")).toBeTruthy();
      expect(reads.filter(table => table === failedTable)).toHaveLength(2);
      expect(reads).not.toContain("resume_contact_focus_items");
      expect(reads).not.toContain("resume_contact_status_items");
      expect(full).not.toHaveBeenCalled();
      expect(store.getSectionState("links-session", resumeId, "contact").status).toBe("loaded");
    }
  });

  it("invalidates Links on sign-out and never gives Overview the Links route-first loader", async () => {
    const store = new ResumeSectionStore(); const repo = repository(); show(repo, "/links", store);
    expect(await screen.findByLabelText("GitHub URL")).toBeTruthy();
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("loaded");
    store.setSession("different-links-session");
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("idle");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("idle");
    cleanup(); const overview = repository(); show(overview, "/overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(overview.loadOverview).toHaveBeenCalledOnce());
    expect(overview.load).not.toHaveBeenCalled();
    expect(overview.loadLinks).not.toHaveBeenCalled();
  });
});
