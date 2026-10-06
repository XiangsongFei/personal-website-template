import { StrictMode } from "react";
import { readFileSync } from "node:fs";
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
    loadAdminWebsiteLinksWriteState: vi.fn().mockResolvedValue({ resumeId, domain: "website_links", writeMode: "direct", activityLogEnabled: false, trustedContextRequired: false }),
    loadAdminFilesWriteState: vi.fn().mockResolvedValue({ resumeId, domain: "files", writeMode: "direct", activityLogEnabled: false, trustedContextRequired: false }),
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
  it("keeps Email and GitHub proportions, pairs Resume Files PDFs only in desktop Split, and applies LinkedIn ratios only to its bilingual rows", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const splitCss = readFileSync("src/preview/preview.css", "utf8");
    const desktopSplitRules = css.slice(css.indexOf("@media(min-width:1281px){"), css.indexOf("\n}", css.indexOf("@media(min-width:1281px){")));
    expect(css).toContain(".links-editor-scope .field-grid.links-inline-row{display:grid;grid-template-columns:var(--links-content-columns);column-gap:var(--links-content-gap)");
    expect(splitCss).toContain(".links-editor-scope{--links-split-paired-columns:minmax(280px,2fr) minmax(150px,1fr);--links-split-label-column:104px}");
    expect(splitCss).toContain(".links-section[data-editor-anchor=\"links:public-links\"] .links-object-group .links-inline-row{grid-template-columns:var(--links-split-paired-columns)}");
    expect(splitCss).toContain(".links-section[data-editor-anchor=\"links:public-links\"] .links-object-group .links-inline-field{grid-template-columns:var(--links-split-label-column) minmax(0,1fr)}");
    expect(splitCss).toContain(".links-object-group[data-editor-anchor=\"links:linkedin\"] .links-linkedin-localized .bilingual-field-pair[data-editor-anchor=\"field:links-linkedin-localized:linkedInLabel\"]:not(.is-adaptive-stacked) .bilingual-field-values{grid-template-columns:var(--links-split-paired-columns)}");
    expect(splitCss).toContain(".links-linkedin-localized .links-inline-locale-fields .bilingual-field-values .field{grid-template-columns:var(--links-split-label-column) minmax(0,1fr)}");
    expect(desktopSplitRules).toContain(".editor-preview-layout[data-workspace-view=split] .links-editor-scope .links-object-group[data-editor-anchor=\"links:email\"] .links-inline-row");
    expect(desktopSplitRules).toContain(".editor-preview-layout[data-workspace-view=split] .links-editor-scope .links-object-group[data-editor-anchor=\"links:github\"] .links-inline-row");
    expect(desktopSplitRules).toContain(".editor-preview-layout[data-workspace-view=split] .links-editor-scope .links-object-group[data-editor-anchor=\"links:linkedin\"]>.links-inline-row");
    expect(desktopSplitRules).not.toContain("field:links-linkedin-localized:linkedInHref");
    expect(desktopSplitRules).not.toContain("data-workspace-view=edit");
    expect(desktopSplitRules).toContain(".editor-preview-layout[data-workspace-view=split] .links-editor-scope .links-section[data-editor-anchor=\"links:resume-files\"] .resume-file-grid{grid-template-columns:repeat(2,minmax(0,1fr))}");
    expect(css).not.toContain(".links-object-group[data-editor-anchor=\"links:linkedin\"] .links-inline-row{grid-template-columns");
    expect(css).toContain(".links-editor-scope .links-inline-field{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:end;gap:12px");
  });

  it("uses one compact bilingual matrix header for the navigation label rows", async () => {
    const repo = repository();
    show(repo);
    expect(await screen.findByLabelText("URL")).toBeTruthy();
    const scope = document.querySelector(".links-editor-scope")!;
    expect(scope.querySelectorAll(".navigation-labels .bilingual-field-pair")).toHaveLength(5);
    expect(scope.querySelectorAll(".navigation-labels .bilingual-column-headings")).toHaveLength(1);
    expect(scope.querySelectorAll(".navigation-labels .bilingual-column-headings > span")).toHaveLength(2);
    expect(scope.querySelectorAll(".navigation-labels .links-translation-matrix")).toHaveLength(5);
    expect(Array.from(scope.querySelectorAll(".navigation-labels .bilingual-field-pair > h3"), node => node.textContent)).toEqual([
      "Experience", "Projects", "Skills", "Awards", "Contact",
    ]);
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByLabelText("English Public button label")).toBeTruthy();
  });

  it("starts directly with the four restrained Links sections", async () => {
    const repo = repository();
    show(repo);
    await screen.findByLabelText("URL");
    const scope = document.querySelector(".links-editor-scope")!;
    expect(Array.from(scope.querySelectorAll(".links-section h2")).map(heading => heading.textContent)).toEqual([
      "Public links", "Resume files", "Navigation labels", "Footer text",
    ]);
    expect(scope.querySelectorAll(".page-heading")).toHaveLength(0);
    expect(scope.querySelectorAll(".panel")).toHaveLength(0);
    expect(scope.textContent).not.toContain("The five destinations are fixed");
    expect(scope.textContent).not.toContain("Local draft only. Production writes are disabled");
    expect(screen.getByRole("button", { name: "Save site & link changes" }).hasAttribute("disabled")).toBe(true);
  });

  it("presents every Links field with human-readable labels and fixed navigation descriptors", async () => {
    show(repository());
    await screen.findByLabelText("URL");
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByLabelText("Contact label")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getAllByLabelText("Hero button label")).toHaveLength(2);
    expect(screen.getByLabelText("Chinese Contact label")).toBeTruthy();
    expect(screen.getByLabelText("English Contact label")).toBeTruthy();
    const linkedInUrl = screen.getByLabelText("LinkedIn URL") as HTMLInputElement;
    expect(linkedInUrl.value).toBe(links.translations.zh.linkedInHref);
    expect(document.querySelectorAll(".links-linkedin-url-setting input")).toHaveLength(1);
    expect(screen.queryByLabelText("Chinese URL")).toBeNull();
    expect(screen.queryByLabelText("English URL")).toBeNull();
    expect(screen.getByLabelText("Chinese Public button label")).toBeTruthy();
    expect(screen.getByLabelText("English Public button label")).toBeTruthy();
    expect(screen.queryByLabelText(/portfolio_href/i)).toBeNull();
    const navigationRows = Array.from(document.querySelectorAll(".navigation-labels .links-translation-matrix"));
    expect(navigationRows).toHaveLength(5);
    expect(navigationRows.map(group => group.querySelector(".bilingual-field-pair > h3")?.textContent)).toEqual([
      "Experience", "Projects", "Skills", "Awards", "Contact",
    ]);
    expect(navigationRows.filter(group => group.querySelector(".bilingual-column-headings")).length).toBe(1);
    const linkedinLocalized = document.querySelector(".links-object-group:last-child .links-localized-fields .links-translation-matrix")!;
    expect(Array.from(linkedinLocalized.querySelectorAll(".bilingual-field-pair > h3"), node => node.textContent)).toEqual(["Contact label"]);
    expect(linkedinLocalized.querySelectorAll(".bilingual-field-pair .bilingual-field-values")).toHaveLength(1);
    expect(linkedinLocalized.querySelectorAll(".bilingual-column-headings")).toHaveLength(0);
    expect(Array.from(linkedinLocalized.querySelectorAll(".bilingual-field-pair"), row => row.firstElementChild?.nextElementSibling?.classList.contains("bilingual-field-values"))).toEqual([true]);
    expect(Array.from(linkedinLocalized.querySelectorAll(".bilingual-field-values .field label > span[aria-hidden=true]"), node => node.textContent)).toEqual(["中文", "EN"]);
    const siteTextSection = Array.from(document.querySelectorAll(".links-section")).find(section => section.querySelector("h2")?.textContent === "Footer text")!;
    expect(siteTextSection.querySelector(".links-footer-setting > h3")?.textContent).toBe("Updated-at label");
    expect(siteTextSection.querySelector(".links-footer-setting > p")?.textContent)
      .toBe("Text displayed before the update date in the public resume footer.");
    expect(siteTextSection.querySelectorAll(".bilingual-field-pair > h3")).toHaveLength(0);
    expect(document.querySelector(".links-editor-scope")?.textContent).not.toMatch(/\bexperience\b|\bprojects\b|\bskills\b|\bawards\b|\bcontact\b/);
    for (const label of ["Updated-at label"]) {
      expect(screen.getByLabelText(`English ${label}`)).toBeTruthy();
      expect(screen.getByLabelText(`Chinese ${label}`)).toBeTruthy();
    }
    for (const label of ["Education section title", "Experience section title", "Projects section title", "Skills section title", "Awards section title", "Project link label"]) {
      expect(screen.queryByLabelText(`English ${label}`)).toBeNull();
      expect(screen.queryByLabelText(`Chinese ${label}`)).toBeNull();
    }
    expect(siteTextSection.querySelectorAll(".bilingual-column-headings")).toHaveLength(1);
    const resumeLabelMatrix = document.querySelector(".links-resume-files .links-translation-matrix")!;
    const resumeFiles = document.querySelector(".links-resume-files")!;
    const resumePdfGrid = resumeFiles.querySelector(".resume-file-grid")!;
    expect(resumePdfGrid.children).toHaveLength(2);
    expect(resumePdfGrid.nextElementSibling?.classList.contains("links-localized-fields")).toBe(true);
    expect(resumeLabelMatrix.querySelectorAll(".bilingual-column-headings")).toHaveLength(1);
    expect(resumeLabelMatrix.querySelectorAll(".bilingual-column-headings > span")).toHaveLength(2);
    expect(resumeLabelMatrix.querySelector(".bilingual-field-pair > h3")?.textContent).toBe("Public button label");
    expect(resumeLabelMatrix.querySelector(".bilingual-field-pair > h3")?.nextElementSibling?.classList.contains("bilingual-field-values")).toBe(true);
    expect(document.querySelectorAll(".links-inline-row")).toHaveLength(3);
  });

  it("localizes the Links section hierarchy and save action in Chinese", async () => {
    const repo = repository();
    show(repo);
    await screen.findByLabelText("URL");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    const scope = document.querySelector(".links-editor-scope")!;
    expect(Array.from(scope.querySelectorAll(".links-section h2")).map(heading => heading.textContent)).toEqual([
      "公开链接", "简历文件", "导航标签", "页脚文案",
    ]);
    expect(Array.from(scope.querySelectorAll(".navigation-labels .bilingual-field-pair > h3"), node => node.textContent)).toEqual([
      "工作经历", "项目经历", "技能", "荣誉奖项", "联系方式",
    ]);
    expect(screen.getByLabelText("联系区标签")).toBeTruthy();
    expect(screen.getByLabelText("英文 公开按钮文案")).toBeTruthy();
    const footer = Array.from(scope.querySelectorAll(".links-section")).find(section => section.querySelector("h2")?.textContent === "页脚文案")!;
    expect(footer.querySelector(".links-footer-setting > h3")?.textContent).toBe("更新时间标签");
    expect(footer.querySelector(".links-footer-setting > p")?.textContent).toBe("公开简历页脚中更新时间前显示的文字");
    expect(screen.getByRole("button", { name: "保存网站与链接修改" })).toBeTruthy();
  });

  it("keeps navigation labels and footer text editable, cancellable, and saved through their existing writers", async () => {
    const updatePublicLinks = vi.fn().mockResolvedValue(undefined);
    const updateSiteText = vi.fn().mockResolvedValue(undefined);
    const updateNavigationLabel = vi.fn().mockResolvedValue(undefined);
    const repo = repository();
    Object.assign(repo, { updatePublicLinks, updateSiteText, updateNavigationLabel });
    show(repo);
    const chineseNavigation = await screen.findByLabelText("Chinese Experience") as HTMLInputElement;
    const englishFooter = screen.getByLabelText("English Updated-at label") as HTMLInputElement;
    const initialNavigation = chineseNavigation.value;
    const initialFooter = englishFooter.value;
    fireEvent.change(chineseNavigation, { target: { value: "工作（草稿）" } });
    fireEvent.change(englishFooter, { target: { value: "Last updated" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Chinese Experience") as HTMLInputElement).value).toBe(initialNavigation);
    expect((screen.getByLabelText("English Updated-at label") as HTMLInputElement).value).toBe(initialFooter);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(updateNavigationLabel).not.toHaveBeenCalled();
    expect(updateSiteText).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Chinese Experience"), { target: { value: "工作（已保存）" } });
    fireEvent.change(screen.getByLabelText("English Updated-at label"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save site & link changes" }));
    await waitFor(() => expect(screen.getByText("No unsaved changes")).toBeTruthy());
    expect(updateNavigationLabel).toHaveBeenCalledWith(resumeId, links.navigation[0].id, "zh", "工作（已保存）");
    expect(updateSiteText).toHaveBeenCalledWith(resumeId, "en", { updatedAtLabel: "Updated" });
  });

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
        { resume_id: resumeId, locale: "zh", education_label: "教育", experience_label: "经历", project_heading: "项目", skills_label: "技能", honors_label: "荣誉", portfolio_label: "中文 PDF", portfolio_href: "https://storage.example.test/example-cv/resume_zh.pdf?cacheNonce=zh-version", kaggle_label: "Kaggle 中", updated_at_label: "更新中", linkedin_label: "领英中", linkedin_href: "https://zh.test" },
        { resume_id: resumeId, locale: "en", education_label: "Education", experience_label: "Experience", project_heading: "Projects", skills_label: "Skills", honors_label: "Awards", portfolio_label: "English PDF", portfolio_href: "https://storage.example.test/example-cv/resume_en.pdf?cacheNonce=en-version", kaggle_label: "Kaggle EN", updated_at_label: "Updated", linkedin_label: "LinkedIn EN", linkedin_href: "https://en.test" },
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
    const storageInfo = vi.fn(async (path: string) => path.endsWith("resume_zh.pdf")
      ? { data: { metadata: { originalFilename: "费湘淞_中文简历.pdf" } }, error: null }
      : { data: null, error: new Error("metadata unavailable") });
    const repo = createResumeRepository({ from, rpc: vi.fn().mockResolvedValue({ data: [{ resume_id: resumeId, site_key: "example-cv", role: "owner" }], error: null }), storage: { from: vi.fn(() => ({ info: storageInfo })) } } as unknown as SupabaseClient);
    const full = vi.spyOn(repo, "load");
    show(repo, "/links", new ResumeSectionStore(), true);
    expect(await screen.findByLabelText("URL")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Current PDF: 费湘淞_中文简历.pdf" }).getAttribute("href"))
      .toBe("https://storage.example.test/example-cv/resume_zh.pdf?cacheNonce=zh-version");
    expect(screen.getByRole("link", { name: "Current PDF: resume_en.pdf" }).getAttribute("href"))
      .toBe("https://storage.example.test/example-cv/resume_en.pdf?cacheNonce=en-version");
    expect(reads).toEqual(["resume_sites", "resume_public_links", "resume_locale_content", "resume_navigation_items", "resume_navigation_item_translations"]);
    expect(full).not.toHaveBeenCalled();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    const mapped = await repo.loadLinks(resumeId);
    expect(mapped.shared).toEqual({ email: "a@example.test", github: "https://github.test/a", githubLabel: "GitHub", linkedInDisplayName: "Name", emailLabel: "Email", linkedInLabel: "LinkedIn" });
    expect(mapped.translations.zh.portfolioLabel).toBe("中文 PDF");
    expect(mapped.translations.en.portfolioLabel).toBe("English PDF");
    expect(mapped.resumePdfFilenames).toEqual({ zh: "费湘淞_中文简历.pdf", en: "resume_en.pdf" });
    expect(storageInfo).toHaveBeenCalledWith("example-cv/resume_zh.pdf");
    expect(storageInfo).toHaveBeenCalledWith("example-cv/resume_en.pdf");
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
      expect(await screen.findByLabelText(locale === "en" ? "URL" : "链接地址")).toBeTruthy();
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
    go("Site & Links");
    expect(await screen.findByLabelText("URL")).toBeTruthy();
    expect(repo.loadLinks).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    expect(store.getSectionState("links-session", resumeId, "contact").status).toBe("loaded");
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("loaded");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByLabelText("链接地址")).toBeTruthy();
    fireEvent.click(document.querySelector('a[href="/contact"]')!);
    expect(await screen.findByLabelText("英文 部分标签")).toBeTruthy();
    fireEvent.click(document.querySelector('a[href="/links"]')!);
    expect(await screen.findByLabelText("链接地址")).toBeTruthy();
    expect(repo.loadContact).toHaveBeenCalledOnce();
    expect(repo.loadLinks).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("preserves Links and Contact drafts through each other and route-first Overview", async () => {
    const repo = repository(); show(repo);
    expect(await screen.findByLabelText("URL")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://saved-local.example.test" } });
    expect(repo.loadLinks).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://draft.example.test" } });
    go("Contact");
    expect(await screen.findByLabelText("English Section label")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English Section label"), { target: { value: "Dirty Contact draft" } });
    go("Site & Links");
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("https://draft.example.test");
    go("Contact");
    expect((screen.getByLabelText("English Section label") as HTMLInputElement).value).toBe("Dirty Contact draft");
    go("Site & Links");
    go("Overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(repo.loadOverview).toHaveBeenCalledOnce());
    expect(repo.load).not.toHaveBeenCalled();
    go("Site & Links");
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("https://draft.example.test");
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
      const repo = createResumeRepository({ from, rpc: vi.fn().mockResolvedValue({ data: [{ resume_id: resumeId, site_key: "example-cv", role: "owner" }], error: null }) } as unknown as SupabaseClient);
      const full = vi.spyOn(repo, "load");
      const store = new ResumeSectionStore(); store.setSession("links-session");
      await store.loadSection("links-session", resumeId, "contact", async () => structuredClone(fixtureSections.contact));
      show(repo, "/links", store);
      await screen.findByRole("alert");
      expect(store.getSectionState("links-session", resumeId, "contact").status).toBe("loaded");
      expect(store.getSectionState("links-session", resumeId, "links").status).toBe("error");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByLabelText("URL")).toBeTruthy();
      expect(reads.filter(table => table === failedTable)).toHaveLength(2);
      expect(reads).not.toContain("resume_contact_focus_items");
      expect(reads).not.toContain("resume_contact_status_items");
      expect(full).not.toHaveBeenCalled();
      expect(store.getSectionState("links-session", resumeId, "contact").status).toBe("loaded");
    }
  });

  it("invalidates Links on sign-out and never gives Overview the Links route-first loader", async () => {
    const store = new ResumeSectionStore(); const repo = repository(); show(repo, "/links", store);
    expect(await screen.findByLabelText("URL")).toBeTruthy();
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("loaded");
    store.setSession("different-links-session");
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("idle");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(store.getSectionState("links-session", resumeId, "links").status).toBe("idle");
    cleanup(); const overview = repository(); show(overview, "/overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(overview.loadOverview).toHaveBeenCalledOnce());
    expect(overview.load).not.toHaveBeenCalled();
    expect(overview.loadLinks).not.toHaveBeenCalled();
  });
});
