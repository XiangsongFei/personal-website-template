import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import type { LoadedResume } from "../src/data/resumeMapper";
import type { ResumeRepository } from "../src/data/resumeRepository";
import type { EducationItem } from "../src/model";
import { UiLocaleProvider } from "../src/uiLocale";

const resumeId = "preview-resume";
const resume: LoadedResume = {
  resumeId,
  siteKey: "example-cv",
  isPublished: true,
  updatedAt: null,
  sections: structuredClone(fixtureSections),
};

function repository() {
  const rows = structuredClone(fixtureSections.education);
  const repo = {
    updateProfileSharedDetails: vi.fn(async (_id: string, shared: typeof fixtureSections.profile.shared) => ({ resumeId, updatedAt: null, shared })),
    updateProfileTranslation: vi.fn(async (_id: string, locale: "zh" | "en", translation: typeof fixtureSections.profile.translations.en) => ({ resumeId, locale, translation })),
    updateEducationEntry: vi.fn(async (_id: string, entryId: string, changes: Partial<Pick<EducationItem, "position" | "entryType" | "category">>) => {
      const current = rows.find(item => item.id === entryId)!;
      return { resumeId, entryId, position: changes.position ?? current.position, entryType: changes.entryType ?? current.entryType, category: changes.category ?? current.category ?? (current.entryType === "summerSchool" ? "summerSchool" : null), sourceKey: current.sourceKey };
    }),
    updateEducationTranslation: vi.fn(async (_id: string, entryId: string, locale: "zh" | "en", translation: EducationItem["translations"]["zh"]) => ({ resumeId, entryId, locale, translation })),
    updateEditableEntryPosition: vi.fn(), insertEditableEntry: vi.fn(), updateEditableTranslation: vi.fn(),
    insertEditableTranslation: vi.fn(), deleteEditableTranslation: vi.fn(), deleteEditableEntry: vi.fn(),
    updateProjectMethod: vi.fn(), insertProjectMethod: vi.fn(), deleteProjectMethod: vi.fn(),
    insertEducationEntry: vi.fn(),
    insertEducationTranslation: vi.fn(),
    readEducationTranslation: vi.fn(),
    deleteEducationEntry: vi.fn(),
  };
  return repo as unknown as ResumeRepository & typeof repo;
}

function open(path: string, repo = repository(), sections = structuredClone(fixtureSections), productionRepeatable = false) {
  const loadedResume = { ...resume, sections };
  const routeSection = path.slice(1) as "introduction" | "experience" | "projects" | "skills";
  const view = render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test"
    onSignOut={() => {}} signOutPending={false} signOutError="" resume={loadedResume} repository={repo}
    additionalResumeId={productionRepeatable ? resumeId : null}
    additionalSections={productionRepeatable ? { [routeSection]: sections[routeSection] } : {}}
    onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter></UiLocaleProvider>);
  return { ...view, repo };
}

function preview() {
  return within(screen.getByTestId("resume-preview"));
}

function setPreviewLocale(locale: "zh" | "en") {
  const viewport = screen.getByTestId("resume-preview");
  if (viewport.getAttribute("lang") !== locale) fireEvent.click(within(viewport).getByRole("button", { name: "Preview language" }));
}

const previewRoutes = ["/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links"] as const;
function PreviewRouteNavigation() {
  const navigate = useNavigate();
  return <nav aria-label="Preview route test controls">{previewRoutes.map(path => <button key={path} type="button" onClick={() => navigate(path)}>{path}</button>)}</nav>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Profile and Education live-preview prototype", () => {
  it("keeps the workspace tabs sticky below the shell header and omits the duplicate Preview toolbar", () => {
    open("/profile");
    const tabs = screen.getByRole("group", { name: "Editor or preview view" });
    const editorTab = within(tabs).getByRole("button", { name: "Editor" });
    const previewTab = within(tabs).getByRole("button", { name: "Preview" });
    expect(editorTab.getAttribute("aria-pressed")).toBe("true");

    const css = readFileSync("src/preview/preview.css", "utf8");
    expect(css).toContain(".preview-route-main{padding-top:18px}");
    expect(css).toContain("position:sticky;top:var(--shell-header-height,68px);z-index:24;background:#fff");
    expect(css).toContain(".editor-preview-toggle button[aria-pressed=true]{border-bottom-color:#333;color:#222;font-weight:600}");

    fireEvent.click(previewTab);
    expect(previewTab.getAttribute("aria-pressed")).toBe("true");
    const panel = screen.getByRole("complementary", { name: "Resume preview" });
    expect(panel.querySelector(".resume-preview-toolbar")).toBeNull();
    expect(panel.querySelector(".resume-preview-languages")).toBeNull();
    expect(panel.querySelector(".resume-preview-nav-links button[aria-label='Preview language']")).toBeTruthy();
    expect(css).toContain(".resume-preview-viewport{min-height:320px;margin-top:0");
    expect(css).toContain(".resume-preview-panel{position:static;min-width:0;display:flex;flex-direction:column");
    expect(css).toContain(".resume-preview-viewport{min-height:320px;margin-top:0;overflow:visible");
    expect(css).toContain(".resume-preview-stage{position:relative;width:100%;overflow:visible;container-type:inline-size;container-name:preview-stage}");
    expect(css).not.toMatch(/\.resume-preview-(?:panel|viewport|stage)[^}]*max-height/);
    expect(css).toContain("@container preview-stage (min-width:500px){.resume-preview-hero{padding-right:32px;padding-left:32px}.resume-preview-hero-grid{grid-template-columns:minmax(0,1.65fr) minmax(250px,1fr);gap:16px}}");
    expect(css).not.toContain("@media(min-width:1440px){.resume-preview-hero");
    expect(css).toContain(".resume-preview-sticky-nav{position:sticky;top:var(--shell-header-height,68px);z-index:3;width:100%;background:#fff}");
    expect(css).toContain(".resume-preview-nav-canvas{position:absolute;top:0;left:0;width:980px;padding:16px 49px;transform-origin:top left}");
    const previewStage = panel.querySelector(".resume-preview-stage") as HTMLElement;
    const stickyNav = panel.querySelector(".resume-preview-sticky-nav") as HTMLElement;
    const contentClip = panel.querySelector(".resume-preview-content-clip") as HTMLElement;
    const previewCanvas = panel.querySelector(".resume-preview-canvas") as HTMLElement;
    expect(stickyNav.parentElement).toBe(previewStage);
    expect(stickyNav.nextElementSibling).toBe(contentClip);
    expect(contentClip.parentElement).toBe(previewStage);
    expect(contentClip.firstElementChild).toBe(previewCanvas);
    expect(stickyNav.querySelector("nav[aria-label='Public resume navigation']")).toBeTruthy();
    expect(previewCanvas.querySelector(".resume-preview-sticky-nav")).toBeNull();
    expect(css).toContain(".resume-preview-content-clip{position:relative;z-index:0;width:100%;overflow:clip;isolation:isolate}");
    expect(css).not.toMatch(/\.resume-preview-content-clip[^}]*overflow:(?:auto|scroll)/);
    expect((stickyNav.querySelector(".resume-preview-nav-canvas") as HTMLElement).style.transform).toBe("scale(1)");
    expect(stickyNav.style.top).toBe("68px");
    expect(css).toContain("max-width:1360px");
    expect(css).toContain("clamp(500px,calc(50vw - 155px),650px)");
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-scroll-mode")).toBe("document");

    fireEvent.click(editorTab);
    expect(editorTab.getAttribute("aria-pressed")).toBe("true");
  });

  it("rounds the sticky and clipped canvas bounds up to a device pixel", () => {
    const nativeRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains("resume-preview-nav-canvas")) return { height: 40.25 } as DOMRect;
      if (this.classList.contains("resume-preview-canvas")) return { height: 210.25 } as DOMRect;
      return nativeRect.call(this);
    });

    open("/profile");

    const viewport = screen.getByTestId("resume-preview");
    const stickyNav = viewport.querySelector(".resume-preview-sticky-nav") as HTMLElement;
    const contentClip = viewport.querySelector(".resume-preview-content-clip") as HTMLElement;
    const stage = viewport.querySelector(".resume-preview-stage") as HTMLElement;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const expectedNavCoverage = Math.ceil(40.25 * devicePixelRatio) / devicePixelRatio;
    const expectedCanvasCoverage = Math.ceil(210.25 * devicePixelRatio) / devicePixelRatio;
    expect(Number.parseFloat(stickyNav.style.height)).toBe(expectedNavCoverage);
    expect(Number.parseFloat(contentClip.style.height)).toBe(expectedCanvasCoverage);
    expect(Number.parseFloat(stage.style.height)).toBe(expectedNavCoverage + expectedCanvasCoverage);
  });

  it("renders Profile as a public-style hero followed by the beginning of Education", () => {
    open("/profile");
    expect(preview().getByRole("navigation", { name: "Public resume navigation" })).toBeTruthy();
    expect(preview().getByRole("heading", { level: 1, name: "Demo User" })).toBeTruthy();
    expect(screen.getByTestId("resume-preview").querySelectorAll(".resume-preview-intro p").length).toBeGreaterThan(0);
    expect(screen.getByTestId("resume-preview").querySelectorAll(".resume-preview-actions a").length).toBeGreaterThan(0);
    expect(screen.getByTestId("resume-preview").querySelector(".resume-preview-portrait")).toBeTruthy();
    expect(preview().getByRole("heading", { level: 3, name: "Undergraduate Education" })).toBeTruthy();
  });

  it("keeps Education in the same continuous public-style page after the hero", () => {
    open("/education");
    const viewport = screen.getByTestId("resume-preview");
    const hero = viewport.querySelector(".resume-preview-hero");
    const education = viewport.querySelector(".resume-preview-education-section");
    expect(preview().getByRole("heading", { level: 1, name: "Demo User" })).toBeTruthy();
    expect(hero && education && hero.compareDocumentPosition(education) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(viewport.querySelectorAll(".resume-preview-education-entry").length).toBe(fixtureSections.education.length);
  });

  it("previews an unsaved Chinese summer-school description and Cancel restores the confirmed text", () => {
    open("/education");
    setPreviewLocale("zh");
    fireEvent.click(screen.getByRole("button", { name: "Edit Summer School" }));
    const field = screen.getByLabelText("Chinese Course description") as HTMLTextAreaElement;
    const updated = "这是一个完全由内容管理系统控制的课程描述。";

    fireEvent.change(field, { target: { value: updated } });

    const previewDescription = () => screen.getByTestId("resume-preview").querySelector(".resume-preview-course-description .resume-preview-marked-text");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(previewDescription()?.textContent).toBe(updated);
    expect(previewDescription()?.getAttribute("data-preview-modified")).toBe("true");
    expect(screen.getByText("Review English")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Chinese Course description") as HTMLTextAreaElement).value)
      .toBe(fixtureSections.education[1].translations.zh.courseDescription);
    expect(previewDescription()?.textContent).toBe(fixtureSections.education[1].translations.zh.courseDescription);
    expect(previewDescription()?.getAttribute("data-preview-modified")).toBe("false");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.queryByText("Review English")).toBeNull();
  });

  it("renders one identical complete resume document across every editor route while route focus changes independently", () => {
    const repo = repository();
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/profile"]}><PreviewRouteNavigation /><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" productionMode resume={structuredClone(resume)} repository={repo}
      additionalResumeId={resumeId} onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter></UiLocaleProvider>);

    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "Canonical unsaved name" } });
    fireEvent.click(screen.getByRole("button", { name: "/experience" }));
    fireEvent.change(screen.getByLabelText("English Organization"), { target: { value: "Canonical unsaved organization" } });
    const viewport = screen.getByTestId("resume-preview");
    const pageMarkup = viewport.querySelector(".resume-preview-page")!.innerHTML;
    const focusForRoute: Record<(typeof previewRoutes)[number], string> = {
      "/profile": "about", "/introduction": "about", "/education": "education", "/experience": "experience",
      "/projects": "projects", "/skills": "skills", "/awards": "awards", "/contact": "contact", "/links": "about",
    };

    expect(within(viewport).getByRole("heading", { level: 1, name: "Canonical unsaved name" })).toBeTruthy();
    expect(viewport.querySelector("#preview-experience")?.textContent).toContain("Canonical unsaved organization");
    for (const path of previewRoutes) {
      fireEvent.click(screen.getByRole("button", { name: path }));
      const currentViewport = screen.getByTestId("resume-preview");
      expect(currentViewport.getAttribute("data-preview-focus"), path).toBe(focusForRoute[path]);
      expect(currentViewport.querySelector(".resume-preview-page")!.innerHTML, path).toBe(pageMarkup);
      expect(currentViewport.querySelectorAll(".resume-preview-education-entry")).toHaveLength(fixtureSections.education.length);
      expect(currentViewport.querySelector(".resume-preview-hero h1 .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("true");
      expect(currentViewport.querySelector("#preview-education")?.querySelector(".resume-preview-marked-text[data-preview-modified='true']")).toBeNull();
    }
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    expect(repo.updateEditableTranslation).not.toHaveBeenCalled();
  });

  it("keeps Introduction modified highlighting attached to the stable paragraph after reorder and locale switch", () => {
    const repo = repository();
    const sections = structuredClone(fixtureSections);
    sections.introduction.push({ ...structuredClone(sections.introduction[0]), id: "intro-second", sourceKey: "intro-second-key", position: 2,
      translations: { zh: { text: "第二段中文" }, en: { text: "Second introduction paragraph" } } });
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/introduction"]}><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" productionMode resume={{ ...resume, sections }} repository={repo}
      additionalSections={{ introduction: sections.introduction }} additionalResumeId={resumeId}
      onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter></UiLocaleProvider>);
    const firstItemId = sections.introduction[0].sourceKey ?? sections.introduction[0].id;
    fireEvent.change(screen.getAllByLabelText("English Paragraph")[0], { target: { value: "Modified stable paragraph" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Introduction 1 down" }));

    const intro = screen.getByTestId("resume-preview").querySelector(".resume-preview-intro")!;
    expect(Array.from(intro.querySelectorAll("p"), node => node.textContent)).toEqual(["All content here is a local demo.", "Modified stable paragraph", "Second introduction paragraph"]);
    expect(intro.querySelector(`[data-preview-item-id="${firstItemId}"] .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    expect(intro.querySelector(`[data-preview-item-id="intro-second-key"] .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("false");
    setPreviewLocale("zh");
    expect(intro.querySelector(`[data-preview-item-id="${firstItemId}"] .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("false");
    expect(repo.updateEditableEntryPosition).not.toHaveBeenCalled();
  });

  it("updates the Profile preview immediately for an unsaved Chinese edit", () => {
    open("/profile");
    setPreviewLocale("zh");
    expect(preview().getByRole("img", { name: "示例用户的个人头像" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Chinese Name"), { target: { value: "新的中文姓名" } });
    expect(preview().getByRole("heading", { level: 1, name: "新的中文姓名" })).toBeTruthy();
    expect(preview().getByRole("img", { name: "新的中文姓名的个人头像" })).toBeTruthy();
    expect(screen.getByTestId("resume-preview").querySelector(".resume-preview-hero h1 .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("true");
  });

  it("updates the Profile preview immediately for an unsaved English edit", () => {
    open("/profile");
    expect(preview().getByRole("img", { name: "Portrait of Demo User" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "New English Name" } });
    expect(preview().getByRole("heading", { level: 1, name: "New English Name" })).toBeTruthy();
    expect(preview().getByRole("img", { name: "Portrait of New English Name" })).toBeTruthy();
  });

  it("updates public shared Profile values in the preview before saving", () => {
    open("/profile");
    fireEvent.change(screen.getByLabelText("Graduation value"), { target: { value: "2031" } });
    expect(preview().getByText("2031")).toBeTruthy();
    expect(preview().getByRole("heading", { level: 1, name: "Demo User" })).toBeTruthy();
  });

  it("keeps preview language independent from the admin UI language", () => {
    open("/profile");
    setPreviewLocale("zh");
    fireEvent.click(within(screen.getByRole("group", { name: "CMS interface language" })).getByRole("button", { name: "中文" }));
    expect(preview().getByRole("heading", { level: 1, name: "示例用户" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "个人资料" })).toBeTruthy();
    expect(screen.getByTestId("resume-preview").getAttribute("lang")).toBe("zh");
    expect(preview().getByRole("button", { name: "预览语言" })).toBeTruthy();
  });

  it("updates Education text and locale immediately without repository writes", () => {
    const repo = repository();
    open("/education", repo);
    setPreviewLocale("zh");
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "未保存的中文教育" } });
    expect(preview().getByRole("heading", { level: 3, name: "未保存的中文教育" })).toBeTruthy();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Unsaved English education" } });
    setPreviewLocale("en");
    expect(preview().getByRole("heading", { level: 3, name: "Unsaved English education" })).toBeTruthy();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });

  it("shows a newly added local Education item in the preview before saving", () => {
    const repo = repository();
    open("/education", repo);
    fireEvent.click(screen.getByRole("button", { name: "Add Education" }));
    const chineseTitles = screen.getAllByLabelText("Chinese Title");
    const englishTitles = screen.getAllByLabelText("English Title");
    fireEvent.change(chineseTitles[chineseTitles.length - 1], { target: { value: "新增教育条目" } });
    fireEvent.change(englishTitles[englishTitles.length - 1], { target: { value: "New education entry" } });
    expect(preview().getByRole("heading", { level: 3, name: "New education entry" })).toBeTruthy();
    setPreviewLocale("zh");
    expect(preview().getByRole("heading", { level: 3, name: "新增教育条目" })).toBeTruthy();
    expect(repo.insertEducationEntry).not.toHaveBeenCalled();
  });

  it("reflects Education reorder immediately and writes only after the existing save action", async () => {
    const repo = repository();
    open("/education", repo);
    const previewHeadings = () => Array.from(document.querySelectorAll(".resume-preview-education-entry h3"), node => node.textContent);
    expect(previewHeadings()).toEqual(["Undergraduate Education", "Academic Program"]);
    const changedEducationId = fixtureSections.education[0].sourceKey!;
    const unchangedEducationId = fixtureSections.education[1].sourceKey!;
    fireEvent.change(screen.getAllByLabelText("English Title")[0], { target: { value: "Unsaved undergraduate" } });
    expect(document.querySelector(`[data-preview-item-id="${changedEducationId}"] h3 .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Move Uncategorized down" }));
    expect(previewHeadings()).toEqual(["Academic Program", "Unsaved undergraduate"]);
    expect(document.querySelector(`[data-preview-item-id="${changedEducationId}"] h3 .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    expect(document.querySelector(`[data-preview-item-id="${unchangedEducationId}"] h3 .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("false");
    expect(repo.updateEducationEntry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    expect(await screen.findByText("Education changes saved to production.")).toBeTruthy();
    expect(repo.updateEducationEntry).toHaveBeenCalled();
  });

  it("keeps Profile edits read-only until the existing save control is clicked", async () => {
    const repo = repository();
    open("/profile", repo);
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "Unsaved until click" } });
    expect(preview().getByRole("heading", { level: 1, name: "Unsaved until click" })).toBeTruthy();
    expect(screen.getByTestId("resume-preview").querySelector(".resume-preview-hero h1 .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("true");
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(repo.updateProfileTranslation).toHaveBeenCalledOnce();
    expect(screen.getByTestId("resume-preview").querySelector(".resume-preview-hero h1 .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("false");
  });

  it("keeps Profile highlights locale-specific and clears them when Cancel restores the baseline", () => {
    open("/profile");
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "English-only draft" } });
    const name = () => screen.getByTestId("resume-preview").querySelector(".resume-preview-hero h1 .resume-preview-marked-text");
    expect(name()?.getAttribute("data-preview-modified")).toBe("true");
    setPreviewLocale("zh");
    expect(name()?.textContent).toBe(fixtureSections.profile.translations.zh.name);
    expect(name()?.getAttribute("data-preview-modified")).toBe("false");
    setPreviewLocale("en");
    expect(name()?.getAttribute("data-preview-modified")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(name()?.textContent).toBe(fixtureSections.profile.translations.en.name);
    expect(name()?.getAttribute("data-preview-modified")).toBe("false");
  });

  it("focuses Introduction at the hero while keeping the shared preview available", () => {
    open("/introduction");
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-focus")).toBe("about");
    expect(within(screen.getByTestId("resume-preview")).getByRole("button", { name: "Preview language" })).toBeTruthy();
  });

  it("updates Introduction drafts in the hero immediately and keeps preview locale independent", () => {
    const repo = repository();
    open("/introduction", repo);
    setPreviewLocale("zh");
    fireEvent.change(screen.getByLabelText("English Paragraph"), { target: { value: "Unsaved introduction paragraph" } });
    expect(preview().getByText("这是一个双语个人网站模板。")).toBeTruthy();
    expect(preview().queryByText("Unsaved introduction paragraph")).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "CMS interface language" })).getByRole("button", { name: "中文" }));
    expect(screen.getByRole("heading", { name: "个人简介" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "CMS interface language" })).getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1, name: "Introduction" })).toBeTruthy();
    expect(preview().getByText("这是一个双语个人网站模板。")).toBeTruthy();
    setPreviewLocale("en");
    expect(preview().getByText("Unsaved introduction paragraph")).toBeTruthy();
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-focus")).toBe("about");
  });

  it("reflects unsaved Experience edits, additions, deletion, and reorder without repository mutations", () => {
    const repo = repository();
    const sections = structuredClone(fixtureSections);
    sections.experience.push({ ...structuredClone(sections.experience[0]), id: "experience-2", sourceKey: "experience-second", position: 1,
      translations: { zh: { ...sections.experience[0].translations.zh, organization: "第二家公司" }, en: { ...sections.experience[0].translations.en, organization: "Second Company" } } });
    open("/experience", repo, sections);
    fireEvent.change(screen.getByLabelText("English Organization"), { target: { value: "Renamed Company" } });
    const experienceSection = screen.getByTestId("resume-preview").querySelector("#preview-experience")!;
    expect(Array.from(experienceSection.querySelectorAll("h3"), node => node.textContent)).toEqual(["Renamed Company", "Second Company"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Renamed Company down" }));
    expect(Array.from(experienceSection.querySelectorAll("h3"), node => node.textContent)).toEqual(["Second Company", "Renamed Company"]);
    fireEvent.click(screen.getByRole("button", { name: "Add experience" }));
    const organizations = screen.getAllByLabelText("English Organization");
    fireEvent.change(organizations[organizations.length - 1], { target: { value: "New Unsaved Company" } });
    expect(within(screen.getByTestId("resume-preview")).getByRole("heading", { level: 3, name: "New Unsaved Company" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete New Unsaved Company" }));
    expect(within(screen.getByTestId("resume-preview").querySelector("#preview-experience")!).queryByText("New Unsaved Company")).toBeNull();
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-focus")).toBe("experience");
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });

  it("synchronizes the mounted production repeatable draft into preview without invoking repository writes", () => {
    const repo = repository();
    open("/experience", repo, structuredClone(fixtureSections), true);
    fireEvent.change(screen.getByLabelText("English Organization"), { target: { value: "Unsaved production draft" } });
    expect(within(screen.getByTestId("resume-preview").querySelector("#preview-experience") as HTMLElement)
      .getByRole("heading", { level: 3, name: "Unsaved production draft" })).toBeTruthy();
    expect(repo.insertEditableEntry).not.toHaveBeenCalled();
    expect(repo.updateEditableTranslation).not.toHaveBeenCalled();
    expect(repo.updateEditableEntryPosition).not.toHaveBeenCalled();
  });

  it("reflects unsaved Project text, method edits, and project reorder immediately", () => {
    const repo = repository();
    const sections = structuredClone(fixtureSections);
    sections.projects.push({ ...structuredClone(sections.projects[0]), id: "project-2", sourceKey: "project-second", position: 1,
      translations: { ...structuredClone(sections.projects[0].translations), en: { ...sections.projects[0].translations.en, title: "Second Project" } } });
    open("/projects", repo, sections);
    fireEvent.change(screen.getAllByLabelText("English Title")[0], { target: { value: "Renamed Project" } });
    fireEvent.change(screen.getByLabelText("English methods 1"), { target: { value: "Live Preview Method" } });
    const projectSection = screen.getByTestId("resume-preview").querySelector("#preview-projects")!;
    const firstProjectId = sections.projects[0].sourceKey!;
    expect(within(projectSection as HTMLElement).getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Renamed Project", "Second Project"]);
    expect(within(projectSection as HTMLElement).getByText("Live Preview Method · Metric Analysis")).toBeTruthy();
    expect(projectSection.querySelector(`[data-preview-item-id="${firstProjectId}"] h3 .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    expect(projectSection.querySelector(`[data-preview-item-id="${firstProjectId}"] .resume-preview-project-methods .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Move Renamed Project down" }));
    expect(within(projectSection as HTMLElement).getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Second Project", "Renamed Project"]);
    expect(projectSection.querySelector(`[data-preview-item-id="${firstProjectId}"] h3 .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    expect(projectSection.querySelector("[data-preview-item-id='project-second'] h3 .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("false");
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-focus")).toBe("projects");
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });

  it("reflects unsaved Skills edits and reordering immediately without repository mutations", () => {
    const repo = repository();
    open("/skills", repo);
    fireEvent.change(screen.getAllByLabelText("English Name")[0], { target: { value: "Languages & Tools" } });
    fireEvent.change(screen.getAllByLabelText("English Skills")[0], { target: { value: "Rust · SQL" } });
    const skillSection = screen.getByTestId("resume-preview").querySelector("#preview-skills")!;
    const firstSkillId = fixtureSections.skills[0].sourceKey!;
    expect(within(skillSection as HTMLElement).getAllByText(/Languages & Tools|Analytics/).map(node => node.textContent)).toEqual(["Languages & Tools", "Analytics"]);
    expect(within(skillSection as HTMLElement).getByText("Rust · SQL")).toBeTruthy();
    expect(skillSection.querySelector(`[data-preview-item-id="${firstSkillId}"] strong .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    expect(skillSection.querySelector(`[data-preview-item-id="${firstSkillId}"] span .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Move Languages & Tools down" }));
    expect(Array.from(skillSection.querySelectorAll(".resume-preview-skill-list strong"), node => node.textContent)).toEqual(["Analytics", "Languages & Tools"]);
    expect(skillSection.querySelector(`[data-preview-item-id="${firstSkillId}"] strong .resume-preview-marked-text`)?.getAttribute("data-preview-modified")).toBe("true");
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-focus")).toBe("skills");
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });
});
