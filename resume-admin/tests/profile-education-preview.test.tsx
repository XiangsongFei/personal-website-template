import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
    updateEducationEntry: vi.fn(async (_id: string, entryId: string, changes: Partial<Pick<EducationItem, "position" | "entryType">>) => {
      const current = rows.find(item => item.id === entryId)!;
      return { resumeId, entryId, position: changes.position ?? current.position, entryType: changes.entryType ?? current.entryType, sourceKey: current.sourceKey };
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

    fireEvent.click(editorTab);
    expect(editorTab.getAttribute("aria-pressed")).toBe("true");
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

  it("updates the Profile preview immediately for an unsaved Chinese edit", () => {
    open("/profile");
    setPreviewLocale("zh");
    fireEvent.change(screen.getByLabelText("Chinese Name"), { target: { value: "新的中文姓名" } });
    expect(preview().getByRole("heading", { level: 1, name: "新的中文姓名" })).toBeTruthy();
  });

  it("updates the Profile preview immediately for an unsaved English edit", () => {
    open("/profile");
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "New English Name" } });
    expect(preview().getByRole("heading", { level: 1, name: "New English Name" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Move Undergraduate Education down" }));
    expect(previewHeadings()).toEqual(["Academic Program", "Undergraduate Education"]);
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
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(repo.updateProfileTranslation).toHaveBeenCalledOnce();
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
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
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
    expect(within(projectSection as HTMLElement).getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Renamed Project", "Second Project"]);
    expect(within(projectSection as HTMLElement).getByText("Live Preview Method · Metric Analysis")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move Renamed Project down" }));
    expect(within(projectSection as HTMLElement).getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Second Project", "Renamed Project"]);
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-focus")).toBe("projects");
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });

  it("reflects unsaved Skills edits and reordering immediately without repository mutations", () => {
    const repo = repository();
    open("/skills", repo);
    fireEvent.change(screen.getAllByLabelText("English Group title")[0], { target: { value: "Languages & Tools" } });
    fireEvent.change(screen.getAllByLabelText("English Skills")[0], { target: { value: "Rust · SQL" } });
    const skillSection = screen.getByTestId("resume-preview").querySelector("#preview-skills")!;
    expect(within(skillSection as HTMLElement).getAllByText(/Languages & Tools|Analytics/).map(node => node.textContent)).toEqual(["Languages & Tools", "Analytics"]);
    expect(within(skillSection as HTMLElement).getByText("Rust · SQL")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move Languages & Tools down" }));
    expect(Array.from(skillSection.querySelectorAll(".resume-preview-skill-list strong"), node => node.textContent)).toEqual(["Analytics", "Languages & Tools"]);
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-focus")).toBe("skills");
    expect(repo.updateProfileTranslation).not.toHaveBeenCalled();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });
});
