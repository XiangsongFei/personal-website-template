import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { App } from "../src/App";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { fixtureSections } from "../src/fixtures";
import type { LoadedResume } from "../src/data/resumeMapper";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import type { ResumeRepository, ResumeSectionRepository, EditableRepeatableSection } from "../src/data/resumeRepository";
import type { ExperienceItem, IntroItem, ProjectItem, SkillItem, AwardItem, Locale, StatusItem } from "../src/model";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "batch6a-resume-id";
const cases = [
  { section: "introduction", path: "/introduction", title: "Introduction", input: "Chinese Paragraph", english: "English Paragraph", first: "这是一个双语个人网站模板。", changed: "已修改的中文段落", tableCount: 2 },
  { section: "experience", path: "/experience", title: "Experience", input: "Chinese Organization", english: "English Organization", first: "示例科技公司", changed: "已修改的中文组织", tableCount: 1 },
  { section: "skills", path: "/skills", title: "Skills", input: "Chinese Name", english: "English Name", first: "编程", changed: "已修改的中文分组", tableCount: 2 },
  { section: "awards", path: "/awards", title: "Awards", input: "Chinese Award name", english: "English Award name", first: "示例项目成果", changed: "已修改的中文荣誉", tableCount: 2 },
] as const;
type Case = typeof cases[number];
type TestSection = Case["section"] | "projects";
type Item = IntroItem | ExperienceItem | ProjectItem | SkillItem | AwardItem;

function auth(): AdminAuthClient {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin", email: "admin@example.test", sessionKey: "batch6a-session" }),
    isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(async () => listener?.("SIGNED_OUT", null)),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }) };
}
function makeRepository(section: TestSection, options: { twoItems?: boolean; failEnOnce?: boolean; failUpdateOnce?: boolean } = {}) {
  const original = structuredClone(fixtureSections[section]) as unknown as Item[];
  const items = options.twoItems ? [...original, { ...structuredClone(original[0]), id: `${original[0].id}-second`, sourceKey: original[0].sourceKey ? `${original[0].sourceKey}-second` : null, position: original.length } as Item] : original;
  const translations = new Map<string, Record<string, unknown>>();
  const createdIds = new Set<string>();
  let failEn = Boolean(options.failEnOnce);
  let failUpdate = Boolean(options.failUpdateOnce);
  let nextId = 0;
  const load = vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) });
  const loadSiteMetadata = vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null });
  const loadMethod = `load${section[0].toUpperCase()}${section.slice(1)}` as keyof ResumeSectionRepository;
  const methods = {
    updateEditableEntryPosition: vi.fn(async (_key: EditableRepeatableSection, targetResumeId: string, id: string, position: number) => {
      const item = items.find(value => value.id === id)!;
      (item as Item).position = position;
      return { resumeId: targetResumeId, entryId: id, position, sourceKey: item.sourceKey ?? null };
    }),
    insertEditableEntry: vi.fn(async (_key: EditableRepeatableSection, targetResumeId: string, position: number) => {
      const id = `production-row-${++nextId}`;
      createdIds.add(id);
      return { resumeId: targetResumeId, entryId: id, position, sourceKey: null };
    }),
    updateEditableTranslation: vi.fn(async (_key: EditableRepeatableSection, targetResumeId: string, id: string, locale: Locale, translation: Record<string, unknown>) => {
      if (failUpdate) { failUpdate = false; throw new Error("temporary translation update failure"); }
      const item = items.find(value => value.id === id)!;
      (item.translations as Record<Locale, Record<string, unknown>>)[locale] = structuredClone(translation);
      return { resumeId: targetResumeId, entryId: id, locale, translation };
    }),
    insertEditableTranslation: vi.fn(async (_key: EditableRepeatableSection, targetResumeId: string, id: string, locale: Locale, translation: Record<string, unknown>) => {
      if (failEn && locale === "en") { failEn = false; throw new Error("temporary English translation failure"); }
      translations.set(`${id}:${locale}`, structuredClone(translation));
      return { resumeId: targetResumeId, entryId: id, locale, translation };
    }),
    readEditableTranslation: vi.fn(async (_key: EditableRepeatableSection, targetResumeId: string, id: string, locale: Locale) => {
      const translation = translations.get(`${id}:${locale}`);
      return translation ? { resumeId: targetResumeId, entryId: id, locale, translation } : null;
    }),
    deleteEditableTranslation: vi.fn(async (_key: EditableRepeatableSection, _targetResumeId: string, id: string, locale: Locale) => { translations.delete(`${id}:${locale}`); }),
    deleteEditableEntry: vi.fn(async (_key: EditableRepeatableSection, _targetResumeId: string, id: string) => { const index = items.findIndex(value => value.id === id); if (index >= 0) items.splice(index, 1); }),
    updateProjectMethod: vi.fn(async (_rid: string, pid: string, mid: string, locale: Locale, changes: { value?: string; position?: number }) => ({ resumeId: _rid, projectId: pid, methodId: mid, locale, position: changes.position ?? 0, value: changes.value ?? "method" })),
    insertProjectMethod: vi.fn(async (_rid: string, pid: string, locale: Locale, position: number, value: string) => ({ resumeId: _rid, projectId: pid, methodId: `method-created-${++nextId}`, locale, position, value })),
    readProjectMethodByPosition: vi.fn().mockResolvedValue(null), deleteProjectMethod: vi.fn(),
    updateContactLabel: vi.fn(async (_rid: string, locale: Locale, contactLabel: string) => ({ resumeId: _rid, locale, contactLabel })),
    updateContactAvailability: vi.fn(), updateFocusPosition: vi.fn(async (_rid: string, id: string, position: number) => ({ resumeId: _rid, entryId: id, position, sourceKey: null })), insertFocus: vi.fn(async (_rid: string, position: number) => ({ resumeId: _rid, entryId: "focus-production-id", position, sourceKey: null })), updateFocusTranslation: vi.fn(), insertFocusTranslation: vi.fn(async (_rid: string, id: string, locale: Locale, translation: Record<string, unknown>) => ({ resumeId: _rid, entryId: id, locale, translation })), readFocusTranslation: vi.fn().mockResolvedValue(null), deleteFocus: vi.fn(),
    updateStatusPosition: vi.fn(async (_rid: string, id: string, position: number) => ({ resumeId: _rid, entryId: id, position, sourceKey: null })), insertStatus: vi.fn(async (_rid: string, position: number, statusType: StatusItem["statusType"]) => ({ resumeId: _rid, entryId: "status-production-id", position, sourceKey: null, statusType })), updateStatusType: vi.fn(), updateStatusTranslation: vi.fn(), insertStatusTranslation: vi.fn(async (_rid: string, id: string, locale: Locale, translation: Record<string, unknown>) => ({ resumeId: _rid, entryId: id, locale, translation })), readStatusTranslation: vi.fn().mockResolvedValue(null), deleteStatus: vi.fn(),
    updatePublicLinks: vi.fn(), updateSiteText: vi.fn(), updateNavigationLabel: vi.fn(),
    uploadResumePdf: vi.fn(async (locale: Locale) => `https://storage.example.test/example-cv/resume_${locale}.pdf?cacheNonce=repository-version`),
  };
  const repository = { load, loadSiteMetadata, loadOverview: vi.fn().mockResolvedValue({ profileName: "Admin" }),
    loadProfile: vi.fn().mockResolvedValue(fixtureSections.profile), loadIntroduction: vi.fn().mockResolvedValue(fixtureSections.introduction),
    loadEducation: vi.fn().mockResolvedValue(fixtureSections.education), loadExperience: vi.fn().mockResolvedValue(fixtureSections.experience),
    loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects), loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards), loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(fixtureSections.links), updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    ...methods, [loadMethod]: vi.fn().mockImplementation(async () => structuredClone(items)),
  } as unknown as ResumeRepository & ResumeSectionRepository & typeof methods;
  return { repository, methods, items, translations, createdIds };
}
function addEducationWriters(repository: ResumeRepository) {
  Object.assign(repository, {
    updateEducationEntry: vi.fn(), updateEducationTranslation: vi.fn(), insertEducationEntry: vi.fn(),
    insertEducationTranslation: vi.fn(), readEducationTranslation: vi.fn(), deleteEducationEntry: vi.fn(),
  });
  return repository;
}
function open(spec: { path: string }, repository: ResumeRepository, store = new ResumeSectionStore(), strict = false) {
  const tree = <UiLocaleProvider><MemoryRouter initialEntries={[spec.path]}><AuthGate client={auth()} resumeRepository={repository} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{tree}</StrictMode> : tree), store };
}
function save() { fireEvent.click(document.querySelector(".save-bar .button.primary") as HTMLButtonElement); }
function chooseStatusType(index: number, optionName: string) {
  fireEvent.click(screen.getAllByRole("combobox", { name: "Status type" })[index]);
  fireEvent.click(within(screen.getByRole("listbox", { name: "Status type" })).getByRole("option", { name: optionName }));
}
function chooseSkillCategory(index: number, optionName: string) {
  fireEvent.click(screen.getAllByRole("combobox").filter(control => control.getAttribute("aria-label")?.startsWith("Skill category"))[index]);
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: optionName }));
}
function NavigateToLinks() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/links")}>Open Links</button>;
}
async function waitForField(id: string): Promise<HTMLInputElement | HTMLTextAreaElement> {
  await waitFor(() => expect(document.getElementById(id)).toBeTruthy());
  return document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
}
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Batch 6A production repeatable CRUD", () => {
  it.each([
    { path: "/education", label: "Chinese Section title", value: "Education section name", key: "educationLabel" },
    { path: "/experience", label: "Chinese Section title", value: "Experience section name", key: "experienceLabel" },
    { path: "/projects", label: "Chinese Section title", value: "Project section name", key: "projectHeading" },
    { path: "/skills", label: "Chinese Section title", value: "Skills section name", key: "skillsLabel" },
    { path: "/awards", label: "Chinese Section title", value: "Awards section name", key: "honorsLabel" },
  ] as const)("relocates and saves $key on $path through the existing site-text writer", async ({ path, label, value, key }) => {
    const setup = makeRepository("skills");
    const repository = path === "/education" ? addEducationWriters(setup.repository) : setup.repository;
    open({ path }, repository);
    const title = await screen.findByLabelText(label) as HTMLInputElement;
    expect(title).toBeTruthy();
    const sectionText = title.closest<HTMLElement>(".section-text-editor")!;
    if (path === "/projects") {
      expect(within(sectionText).getByRole("heading", { name: "Section title", level: 2 })).toBeTruthy();
      expect(within(sectionText).getByText("Public resume section name")).toBeTruthy();
      expect(sectionText.querySelectorAll(".section-text-setting")).toHaveLength(0);
      expect(sectionText.querySelectorAll(".bilingual-field-pair > h3")).toHaveLength(0);
      expect(screen.queryByLabelText("Chinese Project link text")).toBeNull();
    } else {
      expect(within(sectionText).getByRole("heading", { name: "Section title", level: 2 })).toBeTruthy();
      expect(within(sectionText).getByText("Public resume section name")).toBeTruthy();
      expect(sectionText.querySelectorAll(".bilingual-field-pair > h3")).toHaveLength(0);
    }
    expect(title.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(screen.getByLabelText("English Section title")).toBeTruthy();
    expect(screen.queryByLabelText(/Education section title|Experience section title|Projects section title|Skills section title|Awards section title/)).toBeNull();
    fireEvent.change(title, { target: { value } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save();
    await screen.findByText("No unsaved changes");
    expect(setup.methods.updateSiteText).toHaveBeenCalledWith(resumeId, "zh", { [key]: value });
  });

  it("shows the global project link text only below a project URL and saves it through the existing site-text writer", async () => {
    const { repository, methods } = makeRepository("projects");
    open({ path: "/projects" }, repository);
    const heading = await screen.findByLabelText("Chinese Section title") as HTMLInputElement;
    expect(screen.getByRole("heading", { name: "Section title", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Section settings" })).toBeNull();
    expect(screen.queryByLabelText("Chinese Project link text")).toBeNull();
    const url = screen.getByLabelText("Project URL");
    fireEvent.change(url, { target: { value: " https://example.test/project " } });
    const linkLabel = await screen.findByLabelText("Chinese Project link text") as HTMLInputElement;
    expect(screen.getByLabelText("English Project link text")).toBeTruthy();
    const contextualGroup = linkLabel.closest<HTMLElement>(".project-link-text-editor")!;
    expect(linkLabel.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(within(contextualGroup).getByRole("heading", { name: "Project link text", level: 4 })).toBeTruthy();
    expect(within(contextualGroup).getByText("All projects with a Project URL use this same display text.")).toBeTruthy();
    fireEvent.change(url, { target: { value: "   " } });
    expect(screen.queryByLabelText("Chinese Project link text")).toBeNull();
    fireEvent.change(heading, { target: { value: "Project area" } });
    fireEvent.change(url, { target: { value: "https://example.test/project" } });
    const visibleLabel = await screen.findByLabelText("Chinese Project link text") as HTMLInputElement;
    fireEvent.change(visibleLabel, { target: { value: "查看项目" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.updateSiteText).toHaveBeenCalledWith(resumeId, "zh", { projectHeading: "Project area", kaggleLabel: "查看项目" });
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("projects", resumeId, "project-1", "zh",
      expect.objectContaining({ href: "https://example.test/project" }));
  });

  it("keeps approved Experience and Projects fields in the common adaptive single-line set", async () => {
    open({ path: "/experience" }, makeRepository("experience").repository);
    const organization = await screen.findByLabelText("Chinese Organization");
    const role = screen.getByLabelText("Chinese Role");
    const period = screen.getByLabelText("Chinese Period");
    const location = screen.getByLabelText("Chinese Location");
    const description = screen.getByLabelText("Chinese Description");
    const pair = (field: HTMLElement) => field.closest(".bilingual-field-pair")!;

    for (const field of [organization, role, period, location]) {
      expect(pair(field).classList.contains("paired-bilingual-single-line")).toBe(true);
    }
    fireEvent.change(organization, { target: { value: "北京理工新源信息科技有限公司 Beijing Institute of Technology New Energy Information Technology Co., Ltd." } });
    fireEvent.change(role, { target: { value: "Senior Data Analytics and Strategic Research Internship Position" } });
    expect(organization.tagName).toBe("INPUT");
    expect(role.tagName).toBe("INPUT");
    expect(pair(organization).classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(pair(role).classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(pair(description).classList.contains("paired-bilingual-single-line")).toBe(false);
    expect(pair(description).classList.contains("bilingual-field-multiline")).toBe(true);

    cleanup();
    open({ path: "/projects" }, makeRepository("projects").repository);
    const title = await screen.findByLabelText("Chinese Title");
    const subtitle = screen.getByLabelText("Chinese Subtitle");
    const projectPeriod = screen.getByLabelText("Chinese Period");
    const projectDescription = screen.getByLabelText("Chinese Description");
    for (const field of [title, subtitle, projectPeriod]) expect(pair(field).classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(pair(projectDescription).classList.contains("paired-bilingual-single-line")).toBe(false);
    expect(pair(projectDescription).classList.contains("bilingual-field-multiline")).toBe(true);
    expect(screen.getByLabelText("Project URL").closest(".paired-bilingual-single-line")).toBeNull();
    expect(document.querySelector(".projects-methods-heading")).toBeTruthy();
    fireEvent.change(title, { target: { value: "A deliberately long project title that must not change the locale layout" } });
    expect(pair(title).classList.contains("paired-bilingual-single-line")).toBe(true);

    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".experience-editor-scope .paired-bilingual-single-line .bilingual-field-values");
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(css).toContain(".experience-editor-scope .experience-paired-field-heading-above");
    expect(css).toContain("@media (min-width:861px) and (pointer:fine)");
    expect(css).toContain("@container (max-width:620px)");
    expect(css).not.toContain("flex:1 1 300px");
    expect(css).not.toContain("min-width:min(100%,300px)");
    expect(css).not.toContain("245px");
    expect(css).not.toContain("paired-wide-bilingual-field");
    expect(css).not.toContain("education-short-bilingual-field");
  });

  it("adapts Award Name textareas while keeping the shared Year outside the locale region", async () => {
    open({ path: "/awards" }, makeRepository("awards").repository);
    const awardName = await screen.findByLabelText("Chinese Award name");
    const adaptiveNames = awardName.closest(".awards-name-values")!;
    expect(adaptiveNames.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(adaptiveNames.getAttribute("data-editor-anchor")).toContain(":name");
    expect(adaptiveNames.closest(".awards-name-content")?.querySelector("h3")?.textContent).toBe("Award name");
    expect(adaptiveNames.querySelectorAll(".bilingual-field-values textarea")).toHaveLength(2);
    expect(adaptiveNames.querySelectorAll(".awards-input-row-control")).toHaveLength(2);
    const sharedYear = screen.getByRole("textbox", { name: "Year" });
    expect(sharedYear.closest(".awards-name-year-pair")).toBe(awardName.closest(".awards-name-year-pair"));
    expect(sharedYear.closest(".bilingual-field-values")).toBeNull();
    expect(adaptiveNames.contains(sharedYear)).toBe(false);
    const yearControl = sharedYear.closest(".awards-year-control");
    expect(yearControl?.classList.contains("awards-input-row-control")).toBe(true);
    const yearReserve = sharedYear.closest(".awards-year-field")?.querySelector<HTMLElement>(".awards-year-locale-reserve");
    expect(yearReserve?.textContent).toBe("");
    expect(yearReserve?.getAttribute("aria-hidden")).toBe("true");
  });

  it("moves the single Year field after the Award Name block as its real adaptive state stacks and recovers", async () => {
    let valuesWidth = 500;
    const observers: Array<{ notify: () => void }> = [];
    class TestResizeObserver {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push({ notify: () => this.callback([], this as unknown as ResizeObserver) }); }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("CanvasRenderingContext2D", class {});
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
      const style = originalGetComputedStyle(element);
      return element instanceof HTMLElement && element.classList.contains("bilingual-field-values")
        ? { ...style, columnGap: "20px", paddingLeft: "0px", paddingRight: "0px", borderLeftWidth: "0px", borderRightWidth: "0px" } as CSSStyleDeclaration
        : style;
    });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains("bilingual-field-values")) return { width: valuesWidth, height: 80, top: 0, bottom: 80, left: 0, right: valuesWidth, x: 0, y: 0, toJSON() {} } as DOMRect;
      return originalRect.call(this);
    });
    const context = { font: "", measureText: (value: string) => ({ width: value.includes("LONG") ? 280 : value.includes("MID") ? 175 : 40 }) } as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);

    open({ path: "/awards" }, makeRepository("awards").repository);
    const chinese = await screen.findByLabelText("Chinese Award name") as HTMLTextAreaElement;
    const english = screen.getByLabelText("English Award name") as HTMLTextAreaElement;
    const year = screen.getByRole("textbox", { name: "Year" }) as HTMLInputElement;
    const pair = chinese.closest(".awards-name-year-pair")!;
    const adaptive = chinese.closest(".awards-name-values")!;
    const yearField = year.closest(".awards-year-field")!;
    fireEvent.change(year, { target: { value: "2025" } });
    expect(adaptive.classList.contains("is-adaptive-stacked")).toBe(false);

    const assertYearFollowsName = (stacked: boolean) => {
      expect(adaptive.classList.contains("is-adaptive-stacked")).toBe(stacked);
      expect(year.closest(".awards-name-year-pair")).toBe(pair);
      expect(year.closest(".awards-year-field")).toBe(yearField);
      expect(pair.querySelectorAll(".awards-year-field input")).toHaveLength(1);
      expect(year.value).toBe("2025");
      expect(adaptive.compareDocumentPosition(yearField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };

    for (const [field, longValue] of [[chinese, "LONG 中文奖项名称"], [english, "LONG English Award Name"]] as const) {
      field.focus();
      fireEvent.change(field, { target: { value: longValue } });
      assertYearFollowsName(true);
      expect(document.activeElement).toBe(field);
      fireEvent.change(field, { target: { value: field === chinese ? "示例项目成果" : "Example Project Outcome" } });
      assertYearFollowsName(false);
      expect(document.activeElement).toBe(field);
    }

    fireEvent.change(chinese, { target: { value: "LONG 中文奖项名称" } });
    fireEvent.change(english, { target: { value: "LONG English Award Name" } });
    assertYearFollowsName(true);
    fireEvent.change(chinese, { target: { value: "MID 中文奖项名称" } });
    fireEvent.change(english, { target: { value: "MID English Award Name" } });
    assertYearFollowsName(false);
    valuesWidth = 350;
    act(() => observers.at(-1)?.notify());
    assertYearFollowsName(true);
    valuesWidth = 500;
    act(() => observers.at(-1)?.notify());
    assertYearFollowsName(false);
  });

  it("adapts both Skills group title and the unchanged list-like Skills content string", async () => {
    open({ path: "/skills" }, makeRepository("skills").repository);
    const title = await screen.findByLabelText("Chinese Name");
    const items = screen.getByLabelText("Chinese Skills");
    expect(title.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(items.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect((items as HTMLInputElement).value).toBe("Python · SQL · TypeScript");
  });

  it("persists Skills content as the original list-like text value", async () => {
    const skills = makeRepository("skills");
    open({ path: "/skills" }, skills.repository);
    const items = await screen.findByLabelText("Chinese Skills");
    const value = "Python / Rust · Go";
    fireEvent.change(items, { target: { value } });
    save();
    await screen.findByText("No unsaved changes");
    expect(skills.methods.updateEditableTranslation).toHaveBeenCalledWith("skills", resumeId, "skill-1", "zh",
      expect.objectContaining({ items: value }));
  });

  it("keeps Introduction paragraphs full-width and outside the single-line rollout", async () => {
    open({ path: "/introduction" }, makeRepository("introduction").repository);
    const paragraph = await screen.findByLabelText("Chinese Paragraph");
    const pair = paragraph.closest(".bilingual-field-pair")!;
    expect(pair.classList.contains("paired-bilingual-single-line")).toBe(false);
    expect(pair.classList.contains("bilingual-field-multiline")).toBe(true);
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".introduction-editor-scope .bilingual-field-multiline .bilingual-field-values");
    expect(css).toContain("grid-template-columns:minmax(0,1fr)");
  });

  it("pairs only the approved Contact and Links bilingual fields", async () => {
    open({ path: "/contact" }, makeRepository("skills").repository);
    const contactLabel = await screen.findByLabelText("Chinese Section label");
    expect(contactLabel.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(screen.getByLabelText("Chinese Availability").closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(false);
    expect(screen.getByLabelText("Chinese Availability").closest(".bilingual-field-pair")?.classList.contains("bilingual-field-multiline")).toBe(true);
    const focusTitle = screen.getAllByLabelText("Chinese Focus title")[0];
    expect(focusTitle.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(screen.getAllByLabelText("Chinese Detail")[0].closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(screen.getAllByLabelText("Chinese Detail")[0].closest(".bilingual-field-pair")?.classList.contains("bilingual-field-multiline")).toBe(false);
    const statusTitle = screen.getByLabelText("Chinese Status title");
    expect(statusTitle.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(screen.getAllByLabelText("Chinese Detail")[1].closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    const statusType = screen.getByRole("combobox", { name: "Status type" });
    expect(statusType.closest(".paired-bilingual-single-line")).toBeNull();
    cleanup();

    open({ path: "/links" }, makeRepository("skills").repository);
    const linkedinLabel = await screen.findByLabelText("Chinese Contact label");
    expect(linkedinLabel.closest(".bilingual-field-pair")?.classList.contains("paired-short-bilingual-field")).toBe(true);
    expect(linkedinLabel.closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    expect(linkedinLabel.closest(".bilingual-field-values")?.querySelectorAll("input")).toHaveLength(2);
    expect(screen.getByLabelText("LinkedIn URL")).toBeTruthy();
    expect(screen.queryByLabelText("Chinese URL")).toBeNull();
    expect(screen.queryByLabelText("English URL")).toBeNull();
    expect(document.querySelectorAll(".links-linkedin-url-setting input")).toHaveLength(1);
    for (const label of ["Chinese Public button label", "Chinese Experience", "Chinese Updated-at label"]) {
      expect(screen.getByLabelText(label).closest(".bilingual-field-pair")?.classList.contains("paired-bilingual-single-line")).toBe(true);
    }
  });

  it("shows shared project-link text in multiple URL-bearing entries using the same draft and Cancel baseline", async () => {
    const repo = makeRepository("projects", { twoItems: true });
    for (const item of repo.items as ProjectItem[]) {
      item.translations.zh.href = "https://example.test/project";
      item.translations.en.href = "https://example.test/project";
    }
    open({ path: "/projects" }, repo.repository);
    await screen.findByLabelText("Project URL");
    const cards = document.querySelectorAll(".projects-editor-scope .item-card");
    expect(cards).toHaveLength(2);
    fireEvent.click(cards[1].querySelector(".item-actions button")!);
    await waitFor(() => expect(screen.getAllByLabelText("Chinese Project link text")).toHaveLength(2));
    const linkFields = screen.getAllByLabelText("Chinese Project link text") as HTMLInputElement[];
    expect(linkFields.map(field => field.value)).toEqual(["查看示例", "查看示例"]);
    fireEvent.change(linkFields[0], { target: { value: "查看项目" } });
    expect((screen.getAllByLabelText("Chinese Project link text") as HTMLInputElement[]).map(field => field.value))
      .toEqual(["查看项目", "查看项目"]);
    fireEvent.change(screen.getAllByLabelText("Project URL")[0], { target: { value: "   " } });
    expect(screen.getAllByLabelText("Chinese Project link text")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getAllByLabelText("Chinese Project link text") as HTMLInputElement[]).map(field => field.value))
      .toEqual(["查看示例", "查看示例"]);
    expect((screen.getAllByLabelText("Project URL") as HTMLInputElement[]).map(field => field.value))
      .toEqual(["https://example.test/project", "https://example.test/project"]);
  });

  it("keeps the global link text when a project URL is cleared and saved", async () => {
    const repo = makeRepository("projects");
    for (const item of repo.items as ProjectItem[]) {
      item.translations.zh.href = "https://example.test/project";
      item.translations.en.href = "https://example.test/project";
    }
    open({ path: "/projects" }, repo.repository);
    const url = await screen.findByLabelText("Project URL");
    fireEvent.change(screen.getByLabelText("Chinese Project link text"), { target: { value: "查看项目" } });
    fireEvent.change(url, { target: { value: "" } });
    expect(screen.queryByLabelText("Chinese Project link text")).toBeNull();
    save();
    await screen.findByText("No unsaved changes");
    expect(repo.methods.updateSiteText).toHaveBeenCalledWith(resumeId, "zh", { kaggleLabel: "查看项目" });
    expect(repo.methods.updateEditableTranslation).toHaveBeenCalledWith("projects", resumeId, "project-1", "zh",
      expect.objectContaining({ href: "" }));
  });

  it("keeps relocated section text draft in Preview and restores it on Cancel", async () => {
    window.sessionStorage.setItem("example-cv-cms:ui:preview-mode:education", "preview");
    const { repository } = makeRepository("skills");
    open({ path: "/education" }, addEducationWriters(repository));
    const field = await screen.findByLabelText("English Section title") as HTMLInputElement;
    await waitFor(() => expect(document.querySelector("#preview-education .resume-preview-section-label")?.textContent).toBe("Education"));
    fireEvent.change(field, { target: { value: "Learning" } });
    await waitFor(() => expect(document.querySelector("#preview-education .resume-preview-section-label")?.textContent).toBe("Learning"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    await waitFor(() => expect(document.querySelector("#preview-education .resume-preview-section-label")?.textContent).toBe("Education"));
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("saves section text with existing content and keeps only failed text dirty for retry", async () => {
    const { repository, methods } = makeRepository("experience");
    methods.updateSiteText.mockRejectedValueOnce(new Error("temporary section text failure"));
    open({ path: "/experience" }, repository);
    fireEvent.change(await screen.findByLabelText("Chinese Section title"), { target: { value: "经历标题" } });
    fireEvent.change(screen.getByLabelText("Chinese Organization"), { target: { value: "更新后的组织" } });
    save();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(methods.updateSiteText).toHaveBeenCalledWith(resumeId, "zh", { experienceLabel: "经历标题" });
    expect(methods.updateEditableTranslation).toHaveBeenCalled();
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.updateSiteText).toHaveBeenCalledTimes(2);
    expect(methods.updateEditableTranslation).toHaveBeenCalledTimes(1);
  });

  it("guards refresh when only relocated section text is dirty", async () => {
    const { repository } = makeRepository("skills");
    open({ path: "/skills" }, repository);
    fireEvent.change(await screen.findByLabelText("Chinese Section title"), { target: { value: "技能标题" } });
    const event = new Event("beforeunload", { cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("retains a moved section-text draft across sidebar navigation", async () => {
    const { repository } = makeRepository("skills");
    open({ path: "/skills" }, repository);
    const title = await screen.findByLabelText("Chinese Section title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Unsaved skill heading" } });
    fireEvent.click(screen.getByRole("link", { name: "Site & Links" }));
    await screen.findByLabelText("English Updated-at label");
    fireEvent.click(screen.getByRole("link", { name: "Skills" }));
    expect((await screen.findByLabelText("Chinese Section title") as HTMLInputElement).value).toBe("Unsaved skill heading");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel changes" }).hasAttribute("disabled")).toBe(false);
  });

  it.each([
    { section: "experience", path: "/experience", title: "Experience", add: "Add experience" },
    { section: "projects", path: "/projects", title: "Projects", add: "Add project" },
    { section: "skills", path: "/skills", title: "Skills", add: "Add skill group" },
    { section: "awards", path: "/awards", title: "Awards", add: "Add award" },
  ] as const)("places the $section Add action on the main title row", async ({ section, path, title, add }) => {
    const { repository } = makeRepository(section);
    open({ path }, repository);
    const addButton = await screen.findByRole("button", { name: add });
    const titleRow = addButton.closest(".page-heading-title-row");
    expect(titleRow?.querySelector("h1")?.textContent).toBe(title);
    expect(titleRow?.parentElement?.classList.contains("page-heading")).toBe(true);
    expect(document.querySelector(".repeatable-group>.group-heading")).toBeNull();
  });

  it.each(["en", "zh"] as const)("Experience uses localized organization identity and concise copy in %s UI", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository, items } = makeRepository("experience", { twoItems: true });
    const experience = items as ExperienceItem[];
    experience[1].translations.zh.organization = "";
    experience[1].translations.en.organization = "Fallback English Company";
    experience.push({ ...structuredClone(experience[0]), id: "experience-chinese-only", sourceKey: "experience-chinese-only", position: 2,
      translations: { ...structuredClone(experience[0].translations), zh: { ...experience[0].translations.zh, organization: "仅中文公司" }, en: { ...experience[0].translations.en, organization: "" } } });
    open({ path: "/experience" }, repository);

    await screen.findByRole("button", { name: locale === "zh" ? "添加工作经历" : "Add experience" });
    const scope = document.querySelector(".experience-editor-scope")!;
    const headings = () => Array.from(scope.querySelectorAll<HTMLElement>(".item-card-heading h3"), heading => heading.textContent);
    expect(headings()).toEqual(locale === "zh"
      ? ["示例科技公司", "Fallback English Company", "仅中文公司"]
      : ["Example Technology Company", "Fallback English Company", "仅中文公司"]);
    expect(screen.queryByRole("heading", { name: "Experience items" })).toBeNull();
    expect(scope.querySelector(".group-heading h2")).toBeNull();
    expect(scope.textContent).not.toMatch(/Descriptions retain their line breaks|描述会保留换行/);

    const expanded = scope.querySelector(".item-card-body")!;
    expect(expanded.querySelectorAll(".bilingual-column-headings")).toHaveLength(1);
    const descriptions = Array.from(scope.querySelectorAll<HTMLTextAreaElement>("textarea"));
    expect(descriptions.map(field => field.rows)).toEqual([4, 4]);
    expect(descriptions[0].value).toContain("\n");
    expect(descriptions[1].value).toContain("\n");

    fireEvent.click(screen.getByRole("button", { name: locale === "zh" ? "添加工作经历" : "Add experience" }));
    expect(headings()).toEqual(locale === "zh"
      ? ["示例科技公司", "Fallback English Company", "仅中文公司", "工作经历 4"]
      : ["Example Technology Company", "Fallback English Company", "仅中文公司", "Experience 4"]);
    expect(screen.getByRole("button", { name: locale === "zh" ? "保存工作经历修改" : "Save experience changes" })).toBeTruthy();
  });

  it("keeps Experience separators between entries only and removes the save-area rule", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".education-editor-scope .item-card,.experience-editor-scope .item-card,");
    expect(css).toContain(".education-editor-scope .item-card + .item-card,.experience-editor-scope .item-card + .item-card,");
    expect(css).toContain(".education-editor-scope .item-card:last-child,.experience-editor-scope .item-card:last-child,");
    expect(css).toContain(".education-editor-scope .item-card-body,.experience-editor-scope .item-card-body,");
    expect(css).toContain(".experience-editor-scope .save-bar{border-top:0}");
  });

  it("contains visually-hidden labels locally without suppressing document scrolling", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".editor-form .visually-hidden-containing-block,.item-card-heading>div.visually-hidden-containing-block{position:relative}");
    expect(css).not.toMatch(/(?:^|})\s*(?:html|body)(?:\s*,\s*(?:html|body))*\s*\{[^}]*overflow\s*:\s*hidden/i);
  });

  it.each([
    { section: "experience", path: "/experience", field: "Chinese Organization" },
    { section: "projects", path: "/projects", field: "Chinese Title" },
    { section: "skills", path: "/skills", field: "Chinese Name" },
    { section: "awards", path: "/awards", field: "Chinese Award name" },
  ] as const)("$section Cancel restores confirmed values without a success notice", async ({ section, path, field: fieldName }) => {
    const { repository, methods } = makeRepository(section as TestSection);
    open({ path }, repository);
    const field = await screen.findByLabelText(fieldName) as HTMLInputElement | HTMLTextAreaElement;
    const confirmed = field.value;
    fireEvent.change(field, { target: { value: "Unsaved value to discard" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));

    expect(field.value).toBe(confirmed);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.queryByText(/last confirmed production values|changes reverted|上次确认的生产数据|已恢复/i)).toBeNull();
    expect(methods.updateEditableTranslation).not.toHaveBeenCalled();
    expect(methods.insertEditableEntry).not.toHaveBeenCalled();
  });

  it.each([
    { path: "/contact", locale: "en" as const, field: "English Section label", clean: "No unsaved changes" },
    { path: "/contact", locale: "zh" as const, field: "英文 部分标签", clean: "没有未保存修改" },
    { path: "/links", locale: "en" as const, field: "URL", clean: "No unsaved changes" },
    { path: "/links", locale: "zh" as const, field: "链接地址", clean: "没有未保存修改" },
  ])("$path Cancel restores the draft silently in $locale UI", async ({ path, locale, field: fieldName, clean }) => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository, methods } = makeRepository("skills");
    open({ path }, repository);
    const field = await screen.findByLabelText(fieldName) as HTMLInputElement | HTMLTextAreaElement;
    const confirmed = field.value;
    fireEvent.change(field, { target: { value: "Unsaved value to discard" } });
    expect(screen.getByText(locale === "zh" ? "有未保存修改" : "Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: locale === "zh" ? "取消修改" : "Cancel changes" }));

    expect(field.value).toBe(confirmed);
    expect(screen.getByText(clean)).toBeTruthy();
    expect(screen.queryByText(/Local changes reverted|last confirmed production values|changes reverted|已恢复|上次确认的生产数据/i)).toBeNull();
    expect(methods.updateContactLabel).not.toHaveBeenCalled();
    expect(methods.updatePublicLinks).not.toHaveBeenCalled();
  });

  it.each([
    ...cases.map(({ path, section }) => ({ path, section })),
    { path: "/projects", section: "projects" as const },
  ])("omits generic save instructions on $path", async ({ path, section }) => {
    const { repository } = makeRepository(section);
    open({ path }, repository);
    const saveLabel = path === "/introduction" ? "Save Introduction changes" : path === "/experience" ? "Save experience changes" : path === "/projects" ? "Save project changes" : path === "/skills" ? "Save skill changes" : path === "/awards" ? "Save award changes" : "Save production changes";
    await screen.findByRole("button", { name: saveLabel });
    const page = document.querySelector(".page-section")!;
    expect(page.classList.contains("production-save-tail")).toBe(false);
    expect(page.querySelector(".production-save-helper")).toBeNull();
    if (path === "/introduction" || path === "/experience") expect(screen.queryByRole("button", { name: "Save production changes" })).toBeNull();
  });

  it("uses localized Introduction save copy without exposing production-environment wording", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const { repository } = makeRepository("introduction");
    open({ path: "/introduction" }, repository);
    const paragraph = await screen.findByLabelText("中文 Paragraph");
    fireEvent.change(paragraph, { target: { value: "更新后的中文简介" } });
    expect(screen.getAllByRole("button", { name: "保存个人简介修改" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "取消修改" })).toHaveLength(1);
    save();
    await screen.findByText("个人简介修改已保存。");
    const scope = document.querySelector(".introduction-editor-scope")!;
    expect(scope.textContent).not.toMatch(/保存到生产环境|生产环境|Save production changes|production/i);
  });

  it("allows multiple production Introduction entries to stay expanded independently", async () => {
    const { repository } = makeRepository("introduction");
    open({ path: "/introduction" }, repository);
    await screen.findByLabelText("Chinese Paragraph");
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".introduction-editor-scope .item-card"));

    fireEvent.click(screen.getByRole("button", { name: "Edit Introduction 2" }));
    expect(cards.map(card => Boolean(card.querySelector(".item-card-body")))).toEqual([true, true]);

    fireEvent.click(screen.getByRole("button", { name: "Close editor for Introduction 1" }));
    expect(cards.map(card => Boolean(card.querySelector(".item-card-body")))).toEqual([false, true]);
  });

  it.each(["en", "zh"] as const)("Skills has localized concise headings and bilingual paired fields in %s UI", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository, items } = makeRepository("skills", { twoItems: true });
    const groups = items as SkillItem[];
    groups[0].translations[locale].title = "";
    groups[0].translations[locale === "zh" ? "en" : "zh"].title = "Other locale title";
    for (const group of groups.slice(1)) {
      group.translations.zh.title = "";
      group.translations.en.title = "";
    }
    open({ path: "/skills" }, repository);

    await screen.findByRole("button", { name: locale === "zh" ? "添加技能组" : "Add skill group" });
    const scope = document.querySelector(".skills-editor-scope")!;
    expect(scope.querySelector(".page-heading h1")?.textContent).toBe(locale === "zh" ? "技能" : "Skills");
    expect(scope.querySelector(".group-heading h2")).toBeNull();
    expect(scope.textContent).not.toMatch(/Organize bilingual skill groups|按显示顺序整理双语技能分组|Skills items/);
    expect(Array.from(scope.querySelectorAll<HTMLElement>(".admin-dropdown-value"), value => value.textContent)).toEqual([
      locale === "zh" ? "自定义" : "Custom", locale === "zh" ? "自定义" : "Custom", locale === "zh" ? "自定义" : "Custom",
    ]);
    expect(scope.querySelectorAll(".item-card-heading h3")).toHaveLength(0);
    const firstBody = scope.querySelector(".item-card-body")!;
    expect(firstBody.querySelectorAll(".bilingual-column-headings")).toHaveLength(1);
    expect(firstBody.querySelectorAll(".bilingual-field-pair")).toHaveLength(2);
    expect(firstBody.textContent).toContain(locale === "zh" ? "名称" : "Name");
    expect(firstBody.textContent).toContain(locale === "zh" ? "技能内容" : "Skills");
    expect(firstBody.textContent).not.toContain(locale === "zh" ? "分组标题" : "Group title");
    expect(screen.getByRole("button", { name: locale === "zh" ? "保存技能修改" : "Save skill changes" })).toBeTruthy();
  });

  it.each(["en", "zh"] as const)("Skills derives all preset dropdown values from bilingual titles in %s UI", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository, items } = makeRepository("skills");
    const presets = [
      { zh: "编程", en: "Programming" },
      { zh: "数据与系统", en: "Data & Systems" },
      { zh: "分析", en: "Analytics" },
      { zh: "工具", en: "Tools" },
      { zh: "语言", en: "Languages" },
    ];
    const groups = items as SkillItem[];
    groups.splice(0, groups.length, ...presets.map((titles, index) => ({
      ...structuredClone(groups[index % Math.max(groups.length, 1)] ?? fixtureSections.skills[0]),
      id: `skill-preset-${index}`, sourceKey: `skill-preset-${index}`, position: index,
      translations: { zh: { title: titles.zh, items: "技能内容" }, en: { title: titles.en, items: "Skill content" } },
    })));
    open({ path: "/skills" }, repository);
    await screen.findByRole("button", { name: locale === "zh" ? "添加技能组" : "Add skill group" });
    expect(Array.from(document.querySelectorAll<HTMLElement>(".skills-editor-scope .admin-dropdown-value"), value => value.textContent))
      .toEqual(presets.map(titles => titles[locale]));

    const first = screen.getAllByRole("combobox")[0];
    expect(first.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox", { name: locale === "zh" ? "技能分类 01" : "Skill category 01" });
    expect(within(listbox).getByRole("option", { name: presets[0][locale] }).getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("aria-activedescendant")).toBeTruthy();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["en", "zh"] as const)("unknown Skills titles derive Custom without rewriting data in %s UI", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository, items } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations.zh.title = "技术能力";
    group.translations.en.title = "Core Capabilities";
    const original = structuredClone(group.translations);
    open({ path: "/skills" }, repository);
    await screen.findByRole("combobox", { name: locale === "zh" ? "技能分类 01" : "Skill category 01" });
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe(locale === "zh" ? "自定义" : "Custom");
    expect((screen.getByLabelText(locale === "zh" ? "中文 名称" : "Chinese Name") as HTMLInputElement).value).toBe("技术能力");
    expect((screen.getByLabelText(locale === "zh" ? "英文 名称" : "English Name") as HTMLInputElement).value).toBe("Core Capabilities");
    expect(group.translations).toEqual(original);
  });

  it("changing a preset updates blank/default bilingual titles, marks dirty, and Cancel restores the baseline", async () => {
    const { repository, items } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations.zh.title = "";
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    chooseSkillCategory(0, "Analytics");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("分析");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Analytics");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Programming");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it.each(["zh", "en"] as const)("selecting a preset replaces both locale titles even when the previous $customized name was custom", async customized => {
    const { repository, items } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations[customized].title = customized === "zh" ? "技术能力" : "Core Capabilities";
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    chooseSkillCategory(0, "Data & Systems");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("数据与系统");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Data & Systems");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Data & Systems");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("sets arbitrary Custom Skills names to the selected Programming pair and updates the Preview draft", async () => {
    const { repository, items } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations.zh.title = "v好剧";
    group.translations.en.title = "Core Programming";
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Custom");

    chooseSkillCategory(0, "Programming");

    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Programming");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("编程");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Programming");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.queryByText("Review English")).toBeNull();
    expect(screen.queryByText("Review Chinese")).toBeNull();

    const card = document.querySelector(".skills-editor-scope .item-card")!;
    fireEvent.click(card.querySelector(".item-actions button")!);
    expect(screen.queryByLabelText("Chinese Name")).toBeNull();
    fireEvent.click(card.querySelector(".item-actions button")!);
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("编程");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Programming");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Programming");
  });

  it.each([
    { locale: "zh" as const, label: "Chinese Name", edited: "v好剧", exact: "编程" },
    { locale: "en" as const, label: "English Name", edited: "Something Else", exact: "Programming" },
  ])("detaches a preset when the $locale name changes and recognizes the exact pair again", async ({ label, edited, exact }) => {
    const { repository } = makeRepository("skills");
    open({ path: "/skills" }, repository);
    await screen.findByLabelText(label);
    const name = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(name, { target: { value: edited } });
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Custom");

    fireEvent.change(name, { target: { value: exact } });
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Programming");
  });

  it("switches directly between Skills presets as complete bilingual pairs", async () => {
    const { repository } = makeRepository("skills");
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    for (const preset of [
      { option: "Analytics", zh: "分析", en: "Analytics" },
      { option: "Tools", zh: "工具", en: "Tools" },
    ]) {
      chooseSkillCategory(0, preset.option);
      expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe(preset.option);
      expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe(preset.zh);
      expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe(preset.en);
    }
  });

  it("clears prior title review reminders when a preset synchronizes both locales", async () => {
    const { repository } = makeRepository("skills");
    open({ path: "/skills" }, repository);
    const zh = await screen.findByLabelText("Chinese Name");
    fireEvent.change(zh, { target: { value: "手动修改" } });
    expect(screen.getByText("Review English")).toBeTruthy();

    chooseSkillCategory(0, "Programming");

    expect(screen.queryByText("Review English")).toBeNull();
    expect(screen.queryByText("Review Chinese")).toBeNull();
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("编程");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Programming");
  });

  it("selecting Custom clears preset titles and Cancel restores the Languages preset", async () => {
    const { repository, items } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations.zh.title = "语言";
    group.translations.en.title = "Languages";
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    chooseSkillCategory(0, "Custom");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Custom");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("语言");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Languages");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Languages");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("keeps Custom after entering bilingual names, saves them, and derives Custom again after reload", async () => {
    const { repository, items, methods } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations.zh.title = "语言";
    group.translations.en.title = "Languages";
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    chooseSkillCategory(0, "Custom");
    fireEvent.change(screen.getByLabelText("Chinese Name"), { target: { value: "人工智能" } });
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "Artificial Intelligence" } });
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Custom");
    save();
    await screen.findByText("Skill changes saved.");
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("skills", resumeId, expect.any(String), "zh", expect.objectContaining({ title: "人工智能" }));
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("skills", resumeId, expect.any(String), "en", expect.objectContaining({ title: "Artificial Intelligence" }));

    cleanup();
    open({ path: "/skills" }, repository);
    const reloadedCombo = await screen.findByRole("combobox", { name: "Skill category 01" });
    expect(reloadedCombo.querySelector(".admin-dropdown-value")?.textContent).toBe("Custom");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("人工智能");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Artificial Intelligence");
  });

  it("preserves bilingual user-customized titles when Custom is selected", async () => {
    const { repository, items } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations.zh.title = "技术能力";
    group.translations.en.title = "Technical Skills";
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    chooseSkillCategory(0, "Custom");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("技术能力");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Technical Skills");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Custom");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("clears only the preset side for mixed custom and preset titles", async () => {
    const { repository, items } = makeRepository("skills");
    const group = (items as SkillItem[])[0];
    group.translations.zh.title = "技术能力";
    group.translations.en.title = "Programming";
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    chooseSkillCategory(0, "Custom");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("技术能力");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Custom");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("opens and selects the Skills category without toggling the row, and keeps Save/Cancel behavior", async () => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/skills" }, repository);
    const combo = await screen.findByRole("combobox", { name: "Skill category 01" });
    const scope = document.querySelector(".skills-editor-scope")!;
    expect(scope.querySelector(".item-card-body")).toBeTruthy();
    fireEvent.click(combo);
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox", { name: "Skill category 01" });
    expect(within(listbox).getAllByRole("option").map(option => option.textContent)).toEqual([
      "Programming", "Data & Systems", "Analytics", "Tools", "Languages", "Custom",
    ]);
    fireEvent.click(within(listbox).getByRole("option", { name: "Analytics" }));
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Analytics");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("分析");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Analytics");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(scope.querySelector(".item-card-body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(document.querySelector(".skills-editor-scope .admin-dropdown-value")?.textContent).toBe("Programming");
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("编程");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Programming");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();

    const restoredCombo = screen.getByRole("combobox", { name: "Skill category 01" });
    fireEvent.click(restoredCombo);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Skill category 01" })).getByRole("option", { name: "Tools" }));
    save();
    await screen.findByText("Skill changes saved.");
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("skills", resumeId, expect.any(String), "zh", expect.objectContaining({ title: "工具" }));
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("skills", resumeId, expect.any(String), "en", expect.objectContaining({ title: "Tools" }));
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("keeps Skills expansion attached to stable item IDs through close, reorder, add, cancel, and delete", async () => {
    const { repository, methods } = makeRepository("skills", { twoItems: true });
    open({ path: "/skills" }, repository);
    await screen.findByLabelText("Chinese Name");
    const scope = document.querySelector(".skills-editor-scope")!;
    const cards = () => Array.from(scope.querySelectorAll<HTMLElement>(".item-card"));
    const expanded = () => scope.querySelectorAll(".item-card-body").length;
    const initial = cards();
    const firstTitle = "Programming";
    const secondTitle = "Analytics";
    fireEvent.click(screen.getByRole("button", { name: `Edit ${secondTitle}` }));
    expect(expanded()).toBe(2);
    const firstInputId = initial[0].querySelector<HTMLInputElement>("input")!.id;
    const secondInputId = initial[1].querySelector<HTMLInputElement>("input")!.id;
    fireEvent.click(screen.getByRole("button", { name: `Close editor for ${firstTitle}` }));
    expect(expanded()).toBe(1);
    fireEvent.click(initial[0].querySelector<HTMLButtonElement>(".item-actions button")!);
    expect(expanded()).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: `Move ${secondTitle} up` }));
    expect(expanded()).toBe(2);
    expect(document.getElementById(firstInputId)).toBeTruthy();
    expect(document.getElementById(secondInputId)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add skill group" }));
    expect(expanded()).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(expanded()).toBe(2);
    expect(cards()).toHaveLength(initial.length);
    expect(cards()[0].querySelector(".admin-dropdown-value")?.textContent).toBe(firstTitle);
    expect(cards()[1].querySelector(".admin-dropdown-value")?.textContent).toBe(secondTitle);

    fireEvent.click(cards()[0].querySelector<HTMLButtonElement>(".danger-text")!);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(cards()).toHaveLength(initial.length - 1);
    expect(expanded()).toBe(1);
    save();
    await screen.findByText("Skill changes saved.");
    expect(methods.deleteEditableEntry).toHaveBeenCalledWith("skills", resumeId, expect.stringContaining("skill-1"));
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("saves Skills with route-specific copy and keeps the clean state quiet in Chinese", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const { repository, methods } = makeRepository("skills");
    open({ path: "/skills" }, repository);
    const field = await screen.findByLabelText("中文 名称");
    fireEvent.change(field, { target: { value: "已更新技能" } });
    expect(screen.getByRole("button", { name: "保存技能修改" })).toBeTruthy();
    save();
    await screen.findByText("技能修改已保存。");
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("skills", resumeId, expect.any(String), "zh", expect.objectContaining({ title: "已更新技能" }));
    expect(screen.getByText("没有未保存修改")).toBeTruthy();
    expect(document.querySelector(".skills-editor-scope")?.textContent).not.toMatch(/生产环境|Production/);
  });

  it("keeps Skills divider and save-area styling scoped to its editor", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".skills-editor-scope .item-card + .item-card");
    expect(css).toContain(".skills-editor-scope .item-card:last-child");
    expect(css).toContain(".skills-editor-scope .save-bar{border-top:0}");
    expect(css).toContain(".skills-editor-scope .repeatable-group>.group-heading{justify-content:flex-end}");
  });

  it.each(["en", "zh"] as const)("Awards uses localized concise identities and add/save copy in %s UI", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository, items } = makeRepository("awards", { twoItems: true });
    const awards = items as AwardItem[];
    awards[0].translations[locale].name = "";
    awards[0].translations[locale === "zh" ? "en" : "zh"].name = "Other locale award";
    for (const award of awards.slice(1)) {
      award.translations.zh.name = "";
      award.translations.en.name = "";
    }
    open({ path: "/awards" }, repository);

    await screen.findByRole("button", { name: locale === "zh" ? "添加荣誉奖项" : "Add award" });
    const scope = document.querySelector(".awards-editor-scope")!;
    expect(scope.querySelector(".page-heading h1")?.textContent).toBe(locale === "zh" ? "荣誉奖项" : "Awards");
    expect(scope.querySelector(".group-heading h2")).toBeNull();
    expect(scope.textContent).not.toMatch(/Add, remove, and reorder recognitions|在保持双语对应的同时添加、删除和排序荣誉|Awards items/);
    expect(Array.from(scope.querySelectorAll<HTMLElement>(".item-card-heading h3"), heading => heading.textContent)).toEqual([
      "Other locale award", locale === "zh" ? "荣誉奖项 2" : "Award 2", locale === "zh" ? "荣誉奖项 3" : "Award 3",
    ]);
    const [expandedCard, ...collapsedCards] = Array.from(scope.querySelectorAll<HTMLElement>(".item-card"));
    const expandedTitle = expandedCard.querySelector<HTMLElement>(".item-card-heading h3")!;
    expect(expandedTitle.classList.contains("visually-hidden")).toBe(false);
    expect(expandedTitle.textContent).toBe("Other locale award");
    expect(expandedTitle.parentElement?.classList.contains("visually-hidden-containing-block")).toBe(false);
    expect(within(expandedCard).getByRole("button", { name: /(Close editor for|关闭编辑器：)\s*Other locale award/ })).toBeTruthy();
    expect(expandedCard.querySelectorAll(".item-actions button")).toHaveLength(4);
    expect(within(expandedCard).getByLabelText(locale === "zh" ? "中文 荣誉名称" : "Chinese Award name")).toBeTruthy();
    expect(within(expandedCard).getByLabelText(locale === "zh" ? "英文 荣誉名称" : "English Award name")).toBeTruthy();
    const awardNameLabel = expandedCard.querySelector<HTMLLabelElement>(".awards-name-field label")!;
    expect(awardNameLabel.classList.contains("visually-hidden-containing-block")).toBe(true);
    expect(awardNameLabel.querySelector(".visually-hidden")?.textContent).toBe(locale === "zh" ? "中文 荣誉名称" : "Chinese Award name");
    expect(awardNameLabel.htmlFor).toBe(expandedCard.querySelector(".awards-name-field textarea")?.id);
    expect(expandedCard.querySelectorAll(".awards-year-field input")).toHaveLength(1);
    expect(collapsedCards.every(card => !card.querySelector(".item-card-heading h3")?.classList.contains("visually-hidden"))).toBe(true);
    expect(collapsedCards.map(card => card.querySelector(".item-card-heading h3")?.textContent)).toEqual([
      locale === "zh" ? "荣誉奖项 2" : "Award 2", locale === "zh" ? "荣誉奖项 3" : "Award 3",
    ]);
    const body = expandedCard.querySelector(".item-card-body")!;
    expect(body.querySelectorAll(".bilingual-column-headings")).toHaveLength(1);
    expect(Array.from(body.querySelector<HTMLElement>(".bilingual-column-headings")!.children, heading => heading.textContent)).toEqual([
      "", "中文", "EN", locale === "zh" ? "年份" : "Year",
    ]);
    expect(Array.from(body.querySelectorAll<HTMLElement>(".bilingual-field-pair h3"), field => field.textContent)).toEqual([locale === "zh" ? "荣誉名称" : "Award name"]);
    const yearInput = body.querySelector<HTMLInputElement>(".awards-year-field input")!;
    expect(yearInput.closest(".awards-name-year-pair")).toBe(body.querySelector(".bilingual-field-pair"));
    fireEvent.click(within(expandedCard).getByRole("button", { name: /(Close editor for|关闭编辑器：)\s*Other locale award/ }));
    expect(expandedTitle.classList.contains("visually-hidden")).toBe(false);
    expect(expandedTitle.textContent).toBe("Other locale award");
    expect(screen.getByRole("button", { name: locale === "zh" ? "保存荣誉奖项修改" : "Save award changes" })).toBeTruthy();
    expect(scope.textContent).not.toMatch(/Save production changes|保存到生产环境|Changes saved to production|修改已保存到生产环境/);
  });

  it.each(["en", "zh"] as const)("keeps the live %s Award name in the expanded header through edit, collapse, reopen, and Cancel", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository } = makeRepository("awards");
    open({ path: "/awards" }, repository);
    const card = (await screen.findByLabelText(locale === "zh" ? "中文 荣誉名称" : "Chinese Award name")).closest(".item-card") as HTMLElement;
    const headerTitle = () => card.querySelector<HTMLElement>(".item-card-heading h3")?.textContent;
    const localizedName = card.querySelector<HTMLTextAreaElement>(locale === "zh" ? "#award-1-zh-name" : "#award-1-en-name")!;
    const baseline = localizedName.value;
    expect(headerTitle()).toBe(locale === "zh" ? "示例项目成果" : "Example Project Outcome");

    fireEvent.change(card.querySelector<HTMLTextAreaElement>(`#${localizedName.id}`)!, { target: { value: `${baseline} updated` } });
    expect(headerTitle()).toBe(`${baseline} updated`);
    expect(card.querySelector(".item-card-heading h3")?.classList.contains("visually-hidden")).toBe(false);

    fireEvent.click(card.querySelector<HTMLButtonElement>(".item-actions button")!);
    expect(headerTitle()).toBe(`${baseline} updated`);
    fireEvent.click(card.querySelector<HTMLButtonElement>(".item-actions button")!);
    expect(headerTitle()).toBe(`${baseline} updated`);

    fireEvent.click(screen.getByRole("button", { name: locale === "zh" ? "取消修改" : "Cancel changes" }));
    expect(headerTitle()).toBe(baseline);
    expect(card.querySelector<HTMLTextAreaElement>(`#${localizedName.id}`)?.value).toBe(baseline);
  });

  it("auto-grows bilingual Awards names while preserving complete draft, Preview, Cancel, and Save values", async () => {
    const { repository, methods } = makeRepository("awards");
    const view = open({ path: "/awards" }, repository);
    const year = await screen.findByRole("textbox", { name: "Year" });
    expect((year as HTMLInputElement).value).toBe("2024");
    expect(screen.getAllByRole("textbox", { name: "Year" })).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Chinese Year" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "English Year" })).toBeNull();
    const chineseName = screen.getByLabelText("Chinese Award name") as HTMLTextAreaElement;
    const englishName = screen.getByLabelText("English Award name") as HTMLTextAreaElement;
    expect(chineseName.tagName).toBe("TEXTAREA");
    expect(englishName.tagName).toBe("TEXTAREA");
    expect(chineseName.rows).toBe(1);
    expect(englishName.rows).toBe(1);
    expect(chineseName.value).toBe("示例项目成果");
    expect(englishName.value).toBe("Example Project Outcome");

    const longChinese = "面向国际本科生创新实践与跨学科研究的年度优秀项目成果奖";
    const longEnglish = "InternationalUndergraduateInnovationCompetitionAwardForCrossDisciplinaryResearch";
    for (const textarea of [chineseName, englishName]) {
      Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => textarea.value.length > 20 ? 82 : 40 });
    }
    fireEvent.change(chineseName, { target: { value: longChinese } });
    fireEvent.change(englishName, { target: { value: longEnglish } });
    expect(chineseName.value).toBe(longChinese);
    expect(englishName.value).toBe(longEnglish);
    expect(chineseName.style.height).toBe("82px");
    expect(englishName.style.height).toBe("82px");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.change(year, { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => {
      const preview = document.querySelector(".resume-preview-award-list")?.textContent ?? "";
      expect(preview).toContain(longEnglish);
      expect(preview).toContain("2026");
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview language" }));
    await waitFor(() => expect(document.querySelector(".resume-preview-award-list")?.textContent).toContain(longChinese));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByRole("textbox", { name: "Year" }) as HTMLInputElement).value).toBe("2024");
    expect((screen.getByLabelText("Chinese Award name") as HTMLTextAreaElement).value).toBe("示例项目成果");
    expect((screen.getByLabelText("English Award name") as HTMLTextAreaElement).value).toBe("Example Project Outcome");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(methods.updateEditableTranslation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".resume-preview-award-list")?.textContent).toContain("示例项目成果"));
    fireEvent.click(screen.getByRole("button", { name: "Preview language" }));
    await waitFor(() => expect(document.querySelector(".resume-preview-award-list")?.textContent).toContain("Example Project Outcome"));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));

    fireEvent.change(screen.getByLabelText("Chinese Award name"), { target: { value: longChinese } });
    fireEvent.change(screen.getByLabelText("English Award name"), { target: { value: longEnglish } });
    fireEvent.change(screen.getByRole("textbox", { name: "Year" }), { target: { value: "2026" } });
    save();
    await screen.findByText("Award changes saved.");
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("awards", resumeId, "award-1", "zh",
      expect.objectContaining({ name: longChinese, year: "2026" }));
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith("awards", resumeId, "award-1", "en",
      expect.objectContaining({ name: longEnglish, year: "2026" }));
    expect((screen.getByRole("textbox", { name: "Year" }) as HTMLInputElement).value).toBe("2026");

    view.unmount();
    open({ path: "/awards" }, repository);
    expect((await screen.findByRole("textbox", { name: "Year" }) as HTMLInputElement).value).toBe("2026");
    expect((screen.getByLabelText("Chinese Award name") as HTMLTextAreaElement).value).toBe(longChinese);
    expect((screen.getByLabelText("English Award name") as HTMLTextAreaElement).value).toBe(longEnglish);
  });

  it("keeps Award name textarea styling scoped, compact, and single-underline", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".awards-editor-scope .awards-name-field textarea{");
    expect(css).toContain("resize:none;overflow-x:hidden;overflow-y:hidden;overflow-wrap:anywhere;white-space:pre-wrap");
    expect(css).toContain("border:0;border-bottom:1px solid #e2e0dc");
    expect(css).toContain(".awards-editor-scope .awards-input-row-control{display:contents}");
    expect(css).toContain(".awards-editor-scope .awards-year-field input{text-align:left}");
    expect(css).toContain(".awards-name-content>h3{grid-column:1;margin:0;padding-top:8px;color:#444;font-size:14px;font-weight:600;line-height:1.35}");
  });

  it("limits the compact Award Name + Year layout to Split workspaces wider than 1280px", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("@media(min-width:1281px)");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-year-pair{grid-template-columns:minmax(0,5fr) minmax(96px,1fr);grid-template-rows:auto auto auto auto");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-year-pair>.awards-name-content>.awards-name-values{grid-column:1;grid-row:2/span 3;display:grid;grid-template-rows:subgrid");
    expect(css).toContain(".awards-name-year-pair:not(:has(>.awards-name-content>.awards-name-values.is-adaptive-stacked)) .awards-name-values .bilingual-field-values{row-gap:0}");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-values .bilingual-field-values{grid-column:1;grid-row:1/span 3;grid-template-rows:subgrid");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-values .awards-name-field{grid-row:1/span 3;display:grid;grid-template-rows:subgrid");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-control{grid-row:2;display:grid");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-year-field{grid-column:2;grid-row:1/span 4;display:grid;grid-template-rows:subgrid");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-year-locale-reserve{display:block;grid-column:1;grid-row:2;min-height:1lh");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-year-control{grid-column:1;grid-row:3;display:grid");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-control textarea{box-sizing:border-box;border:0;border-bottom:1px solid #e2e0dc;height:auto;min-height:40px;font-family:inherit;font-size:15px;font-weight:400;line-height:1.45;padding:9px 0");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-year-control input{box-sizing:border-box;width:100%;height:40px;min-width:0;min-height:40px;align-self:start;border:0;border-bottom:1px solid #e2e0dc;padding:9px 0;font-family:inherit;font-size:15px;font-weight:400;line-height:1.45");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-control textarea:focus{border-bottom-color:#666}");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-year-control input:focus{border-bottom-color:#666}");
    expect(css).not.toContain(".awards-year-control input{width:100%;height:100%");
    expect(css).toContain(".awards-name-control{grid-row:2;display:grid;align-items:stretch;min-width:0;border:0;box-shadow:none}");
    expect(css).toContain(".awards-year-control{grid-column:1;grid-row:3;display:grid;align-items:start;min-width:0;border:0;box-shadow:none}");
    expect(css).not.toContain("box-shadow:inset 0 -1px 0");
    expect(css).not.toContain("--awards-paired-control-row-height");
    expect(css).toContain(".awards-year-mobile-label{display:block;grid-column:1;grid-row:1;margin:0;padding-top:8px;color:#444;font-size:14px;font-weight:600;line-height:1.35}");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-year-pair:has(>.awards-name-content>.awards-name-values.is-adaptive-stacked){grid-template-rows:auto;row-gap:7px}");
    expect(css).toContain(":has(>.awards-name-content>.awards-name-values.is-adaptive-stacked)>.awards-year-field{grid-column:1/-1;grid-row:auto;display:block}");
    expect(css).toContain(":has(>.awards-name-content>.awards-name-values.is-adaptive-stacked) .awards-year-mobile-label{display:block}");
    expect(css).toContain(":has(>.awards-name-content>.awards-name-values.is-adaptive-stacked) .awards-year-locale-reserve{display:none}");
    expect(css).toContain(".editor-preview-layout[data-workspace-view=split] .awards-editor-scope .awards-name-values .awards-name-field>label>span[aria-hidden=true]{display:block}");
    expect(css).not.toContain(".editor-preview-layout[data-workspace-view=edit] .awards-editor-scope .awards-name-year-pair{grid-template-columns:minmax(0,5fr)");
    expect(css).not.toContain(".editor-preview-layout[data-workspace-view=preview] .awards-editor-scope .awards-name-year-pair{grid-template-columns:minmax(0,5fr)");
  });

  it("places paired Award Name and Year underlines on shared parent grid tracks", async () => {
    open({ path: "/awards" }, makeRepository("awards").repository);
    const chinese = await screen.findByLabelText("Chinese Award name");
    const english = screen.getByLabelText("English Award name");
    const year = screen.getByRole("textbox", { name: "Year" });
    const controls = [chinese, english].map(field => field.closest(".awards-name-control"));
    const yearControl = year.closest(".awards-year-control");

    expect(year.className).toBe("");
    expect(controls.every(control => control?.classList.contains("awards-input-row-control"))).toBe(true);
    expect(yearControl?.classList.contains("awards-input-row-control")).toBe(true);
    expect(controls.every(control => control?.parentElement?.classList.contains("awards-name-field"))).toBe(true);
    expect(yearControl?.parentElement?.classList.contains("awards-year-field")).toBe(true);
    expect(controls.every(control => control?.querySelector("textarea"))).toBe(true);
    expect(yearControl?.querySelector("input")).toBe(year);
  });

  it("keeps the shared Awards Year value and single control when the Admin language changes", async () => {
    const { repository } = makeRepository("awards");
    open({ path: "/awards" }, repository);
    expect((await screen.findByRole("textbox", { name: "Year" }) as HTMLInputElement).value).toBe("2024");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect((await screen.findByRole("textbox", { name: "年份" }) as HTMLInputElement).value).toBe("2024");
    expect(screen.getAllByRole("textbox", { name: "年份" })).toHaveLength(1);
    expect(screen.getByLabelText("中文 荣誉名称")).toBeTruthy();
    expect(screen.getByLabelText("英文 荣誉名称")).toBeTruthy();
  });

  it("uses a stable Chinese-first Awards Year for legacy differences without rewriting them on load", async () => {
    const { repository, methods, items } = makeRepository("awards");
    const awards = items as AwardItem[];
    awards[0].translations.zh.year = "2024";
    awards[0].translations.en.year = "2025";
    open({ path: "/awards" }, repository);
    expect((await screen.findByRole("textbox", { name: "Year" }) as HTMLInputElement).value).toBe("2024");
    expect(methods.updateEditableTranslation).not.toHaveBeenCalled();
    expect(awards[0].translations.zh.year).toBe("2024");
    expect(awards[0].translations.en.year).toBe("2025");

    cleanup();
    const fallback = makeRepository("awards");
    (fallback.items as AwardItem[])[0].translations.zh.year = "";
    (fallback.items as AwardItem[])[0].translations.en.year = "2025";
    open({ path: "/awards" }, fallback.repository);
    expect((await screen.findByRole("textbox", { name: "Year" }) as HTMLInputElement).value).toBe("2025");
    expect(fallback.methods.updateEditableTranslation).not.toHaveBeenCalled();
  });

  it("keeps Awards multi-expand close state independent and focus styles accessible", async () => {
    const { repository } = makeRepository("awards", { twoItems: true });
    open({ path: "/awards" }, repository);
    await screen.findByLabelText("Chinese Award name");
    const scope = document.querySelector(".awards-editor-scope")!;
    const cards = Array.from(scope.querySelectorAll<HTMLElement>(".item-card"));
    fireEvent.click(cards[1].querySelector<HTMLButtonElement>(".item-actions button")!);
    expect(scope.querySelectorAll(".item-card-body")).toHaveLength(2);
    fireEvent.click(cards[0].querySelector<HTMLButtonElement>(".item-actions button")!);
    expect(scope.querySelectorAll(".item-card-body")).toHaveLength(1);
    expect(cards[1].querySelector(".item-card-body")).toBeTruthy();

    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".awards-editor-scope button:focus:not(:focus-visible)");
    expect(css).toContain(":focus-visible{outline:2px solid #77766f;outline-offset:2px}");
  });

  it.each([
    { section: "experience", path: "/experience", input: "Chinese Organization" },
    { section: "projects", path: "/projects", input: "Chinese Title" },
    { section: "skills", path: "/skills", input: "Chinese Name" },
    { section: "awards", path: "/awards", input: "Chinese Award name" },
  ] as const)("keeps $section expansion attached to item identity through reorder, add, and delete", async spec => {
    const { repository, items } = makeRepository(spec.section, { twoItems: true });
    open(spec, repository);
    await screen.findByLabelText(spec.input);
    const initialCards = Array.from(document.querySelectorAll<HTMLElement>(`.${spec.section}-editor-scope .item-card`));
    expect(initialCards.length).toBeGreaterThan(1);
    fireEvent.click(initialCards[1].querySelector<HTMLButtonElement>(".item-actions button")!);
    expect(document.querySelectorAll(`.${spec.section}-editor-scope .item-card-body`)).toHaveLength(2);
    const ids = initialCards.slice(0, 2).map(card => card.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!.id);
    const secondCard = Array.from(document.querySelectorAll<HTMLElement>(`.${spec.section}-editor-scope .item-card`))[1];
    fireEvent.click(secondCard.querySelector<HTMLButtonElement>('[aria-label$=" up"]')!);
    expect(document.querySelectorAll(`.${spec.section}-editor-scope .item-card-body`)).toHaveLength(2);
    for (const id of ids.slice(0, 2)) expect(document.getElementById(id)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: spec.section === "experience" ? "Add experience" : spec.section === "projects" ? "Add project" : spec.section === "skills" ? "Add skill group" : spec.section === "awards" ? "Add award" : "Add item" }));
    expect(document.querySelectorAll(`.${spec.section}-editor-scope .item-card-body`)).toHaveLength(3);
    const cardToDelete = Array.from(document.querySelectorAll<HTMLElement>(`.${spec.section}-editor-scope .item-card`))
      .find(card => card.querySelector<HTMLInputElement | HTMLTextAreaElement>(`input[id^="${items[0].id}-"], textarea[id^="${items[0].id}-"]`));
    fireEvent.click(cardToDelete!.querySelector<HTMLButtonElement>(".danger-text")!);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(document.querySelectorAll(`.${spec.section}-editor-scope .item-card-body`)).toHaveLength(2);
  });

  it.each(cases)("$title saves bilingual edits by real UUID and patches only its section cache", async spec => {
    const { repository, methods } = makeRepository(spec.section);
    const store = new ResumeSectionStore();
    open(spec, repository, store, true);
    const chinese = await screen.findByLabelText(spec.input);
    fireEvent.change(chinese, { target: { value: spec.changed } });
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.updateEditableTranslation).toHaveBeenCalledWith(spec.section, resumeId, expect.stringContaining(spec.section === "introduction" ? "intro-1" : spec.section === "experience" ? "experience-1" : spec.section === "skills" ? "skill-1" : "award-1"), "zh", expect.anything());
    expect(methods.updateEditableTranslation).not.toHaveBeenCalledWith(spec.section, resumeId, expect.anything(), "en", expect.anything());
    expect(repository.load).not.toHaveBeenCalled();
    expect(store.getSectionState("batch6a-session", resumeId, spec.section).status).toBe("loaded");
    const cached = store.getSectionState("batch6a-session", resumeId, spec.section);
    if (cached.status === "loaded") expect((cached.value as unknown as Item[])[0].translations.zh).toMatchObject({ [spec.section === "introduction" ? "text" : spec.section === "experience" ? "organization" : spec.section === "skills" ? "title" : "name"]: spec.changed });
    fireEvent.change(chinese, { target: { value: "second unsaved edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((chinese as HTMLInputElement | HTMLTextAreaElement).value).toBe(spec.changed);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it.each(cases)("$title creates a parent and both translations, replacing the temporary identity", async spec => {
    const { repository, methods, createdIds } = makeRepository(spec.section);
    const store = new ResumeSectionStore(); open(spec, repository, store);
    await screen.findByLabelText(spec.input);
    fireEvent.click(screen.getByRole("button", { name: spec.section === "introduction" ? "Add paragraph" : spec.section === "experience" ? "Add experience" : spec.section === "skills" ? "Add skill group" : spec.section === "awards" ? "Add award" : "Add item" }));
    const inputs = screen.getAllByLabelText(spec.input);
    fireEvent.change(inputs[inputs.length - 1], { target: { value: `${spec.changed} new` } });
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.insertEditableEntry).toHaveBeenCalledOnce();
    expect(methods.insertEditableTranslation).toHaveBeenCalledTimes(2);
    expect([...createdIds]).toEqual(["production-row-1"]);
    expect(methods.insertEditableTranslation).toHaveBeenCalledWith(spec.section, resumeId, "production-row-1", "zh", expect.anything());
    expect(methods.insertEditableTranslation).toHaveBeenCalledWith(spec.section, resumeId, "production-row-1", "en", expect.anything());
    const cached = store.getSectionState("batch6a-session", resumeId, spec.section);
    expect(cached.status).toBe("loaded");
    if (cached.status === "loaded") expect((cached.value as unknown as Item[]).some(item => item.id === "production-row-1")).toBe(true);
    expect(repository.load).not.toHaveBeenCalled();
  });

  it.each(cases)("$title requires delete confirmation and deletes child rows before the production parent", async spec => {
    const { repository, methods } = makeRepository(spec.section);
    open(spec, repository);
    await screen.findByLabelText(spec.input);
    const del = screen.getAllByRole("button", { name: /^Delete / })[0];
    fireEvent.click(del);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.deleteEditableTranslation).toHaveBeenNthCalledWith(1, spec.section, resumeId, expect.any(String), "zh");
    expect(methods.deleteEditableTranslation).toHaveBeenNthCalledWith(2, spec.section, expect.any(String), expect.any(String), "en");
    expect(methods.deleteEditableEntry).toHaveBeenCalledOnce();
    expect(methods.deleteEditableEntry).toHaveBeenCalledWith(spec.section, resumeId, expect.any(String));
  });

  it.each(cases)("$title persists reorder and does not start a full snapshot", async spec => {
    const { repository, methods } = makeRepository(spec.section, { twoItems: true });
    open(spec, repository);
    await screen.findByLabelText(spec.input);
    fireEvent.click(screen.getAllByRole("button", { name: /Move .* up/ }).at(-1)!);
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.updateEditableEntryPosition.mock.calls.length).toBeGreaterThan(2);
    const count = spec.tableCount + 1;
    expect(methods.updateEditableEntryPosition.mock.calls.map(call => call[3])).toEqual([...Array.from({ length: count }, (_, index) => count * 2 + index), ...Array.from({ length: count }, (_, index) => index)]);
    expect(methods.updateEditableEntryPosition).toHaveBeenCalledWith(spec.section, resumeId, `${spec.section === "introduction" ? "intro-1" : spec.section === "experience" ? "experience-1" : spec.section === "skills" ? "skill-1" : "award-1"}-second`, expect.any(Number));
    expect(repository.load).not.toHaveBeenCalled();
  });

  it("recovers a partial create on retry without inserting another parent or duplicating the confirmed locale", async () => {
    const spec = cases[0];
    const { repository, methods } = makeRepository(spec.section, { failEnOnce: true });
    open(spec, repository);
    await screen.findByLabelText(spec.input);
    fireEvent.click(screen.getByRole("button", { name: "Add paragraph" }));
    fireEvent.change(screen.getAllByLabelText(spec.input).at(-1)!, { target: { value: "Recovery paragraph" } });
    save();
    await screen.findByRole("alert");
    expect(methods.insertEditableEntry).toHaveBeenCalledOnce();
    expect(methods.insertEditableTranslation).toHaveBeenCalledTimes(2);
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.insertEditableEntry).toHaveBeenCalledOnce();
    expect(methods.insertEditableTranslation).toHaveBeenCalledTimes(3);
    expect(methods.insertEditableTranslation.mock.calls.map(call => call[3])).toEqual(["zh", "en", "en"]);
    expect(methods.readEditableTranslation).toHaveBeenCalledWith("introduction", resumeId, "production-row-1", "en");
  });

  it("blocks duplicate parent retry when creation is unconfirmed", async () => {
    const spec = cases[0];
    const { repository, methods } = makeRepository(spec.section);
    vi.mocked(methods.insertEditableEntry).mockRejectedValueOnce(new Error("Parent creation was not confirmed; verify production before retrying"));
    open(spec, repository);
    await screen.findByLabelText(spec.input);
    fireEvent.click(screen.getByRole("button", { name: "Add paragraph" }));
    fireEvent.change(screen.getAllByLabelText(spec.input).at(-1)!, { target: { value: "Unconfirmed parent" } });
    save();
    await screen.findByRole("alert");
    expect(methods.insertEditableEntry).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Save Introduction changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(cases)("$title drafts survive internal navigation and UI-language switching without persisting draft values", async spec => {
    const { repository, methods } = makeRepository(spec.section);
    const store = new ResumeSectionStore();
    open(spec, repository, store);
    const field = await screen.findByLabelText(spec.input) as HTMLInputElement | HTMLTextAreaElement;
    const fieldId = field.id;
    fireEvent.change(field, { target: { value: `Unsaved ${spec.title} draft` } });
    const storageValues = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index) ?? "") ?? "");
    expect(storageValues.some(value => value.includes(`Unsaved ${spec.title} draft`))).toBe(false);
    const other = spec.section === "awards" ? "Introduction" : "Awards";
    fireEvent.click(screen.getByRole("link", { name: other }));
    await screen.findByRole("heading", { name: other });
    fireEvent.click(screen.getByRole("link", { name: spec.title }));
    const returnedField = await waitForField(fieldId);
    expect(returnedField.value).toBe(`Unsaved ${spec.title} draft`);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect((document.getElementById(fieldId) as HTMLInputElement | HTMLTextAreaElement).value).toBe(`Unsaved ${spec.title} draft`);
    fireEvent.click(screen.getByRole("button", { name: spec.section === "introduction" ? "保存个人简介修改" : spec.section === "experience" ? "保存工作经历修改" : spec.section === "skills" ? "保存技能修改" : spec.section === "awards" ? "保存荣誉奖项修改" : "保存到生产环境" }));
    await screen.findByText("没有未保存修改");
    expect(methods.updateEditableTranslation).toHaveBeenCalledOnce();
    expect(repository.load).not.toHaveBeenCalled();
  });

  it.each(cases)("$title failed update leaves the draft dirty and allows retry", async spec => {
    const { repository, methods } = makeRepository(spec.section, { failUpdateOnce: true });
    open(spec, repository);
    const field = await screen.findByLabelText(spec.input);
    fireEvent.change(field, { target: { value: `Retry ${spec.title}` } });
    save();
    await screen.findByRole("alert");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(document.querySelector(".editor-footer-state")?.textContent).toBe("Unsaved changes");
    expect((field as HTMLInputElement | HTMLTextAreaElement).value).toBe(`Retry ${spec.title}`);
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.updateEditableTranslation).toHaveBeenCalledTimes(2);
  });

  it.each(cases)("$title mutation leaves all unrelated section caches intact", async spec => {
    const { repository } = makeRepository(spec.section);
    const store = new ResumeSectionStore();
    store.setSession("batch6a-session");
    await store.loadSiteMetadata("batch6a-session", async () => ({ resumeId, siteKey: "example-cv", isPublished: true, updatedAt: null }));
    const otherKeys = ["profile", "education", "introduction", "experience", "projects", "skills", "awards", "contact", "links"] as const;
    for (const key of otherKeys) if (key !== spec.section) await store.loadSection("batch6a-session", resumeId, key, async () => structuredClone(fixtureSections[key]) as never);
    const unrelatedBefore = new Map(otherKeys.filter(key => key !== spec.section).map(key => [key, JSON.stringify(store.getSectionState("batch6a-session", resumeId, key))]));
    open(spec, repository, store);
    fireEvent.change(await screen.findByLabelText(spec.input), { target: { value: spec.changed } });
    save();
    await screen.findByText("No unsaved changes");
    for (const [key, value] of unrelatedBefore) expect(JSON.stringify(store.getSectionState("batch6a-session", resumeId, key))).toBe(value);
  });
  it("creates a locale-specific project method with the returned method UUID", async () => {
    const repo = makeRepository("projects"); open({ path: "/projects" }, repo.repository, new ResumeSectionStore(), true);
    await screen.findByLabelText("Chinese methods 1");
    fireEvent.click(screen.getByRole("button", { name: "Add Chinese method" }));
    fireEvent.change(await screen.findByLabelText("Chinese methods 3"), { target: { value: "新方法" } });
    save(); await screen.findByText("No unsaved changes");
    expect(repo.methods.insertProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "zh", 2, "新方法");
    expect(repo.methods.updateProjectMethod).not.toHaveBeenCalledWith(resumeId, "project-1", expect.stringMatching(/^local-method-/), expect.anything(), expect.anything());
  });

  it("keeps the English add-method action and locale-specific write unchanged", async () => {
    const repo = makeRepository("projects"); open({ path: "/projects" }, repo.repository, new ResumeSectionStore(), true);
    await screen.findByLabelText("English methods 1");
    fireEvent.click(screen.getByRole("button", { name: "Add English method" }));
    fireEvent.change(await screen.findByLabelText("English methods 3"), { target: { value: "New English method" } });
    save(); await screen.findByText("No unsaved changes");
    expect(repo.methods.insertProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "en", 2, "New English method");
  });

  it("deletes and reorders project methods by their real locale-specific UUIDs", async () => {
    const repo = makeRepository("projects"); open({ path: "/projects" }, repo.repository);
    await screen.findByLabelText("English methods 2");
    fireEvent.click(screen.getByRole("button", { name: "Move English methods 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Chinese methods 1" }));
    save(); await screen.findByText("No unsaved changes");
    expect(repo.methods.deleteProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "method-zh-1", "zh");
    expect(repo.methods.updateProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "method-en-2", "en", { position: expect.any(Number) });
  });

  it("creates a project using its returned UUID and recovers a missing translation without a duplicate parent", async () => {
    const repo = makeRepository("projects", { failEnOnce: true });
    open({ path: "/projects" }, repo.repository);
    await screen.findByLabelText("English Title");
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const titles = screen.getAllByLabelText("Chinese Title");
    fireEvent.change(titles.at(-1)!, { target: { value: "New project" } });
    save();
    await screen.findByRole("alert");
    expect(repo.methods.insertEditableEntry).toHaveBeenCalledOnce();
    expect(repo.methods.insertEditableTranslation.mock.calls[0]).toEqual(["projects", resumeId, "production-row-1", "zh", expect.anything()]);
    save();
    await screen.findByText("No unsaved changes");
    expect(repo.methods.insertEditableEntry).toHaveBeenCalledOnce();
    expect(repo.methods.insertEditableTranslation.mock.calls.map(call=>call[3])).toEqual(["zh", "en", "en"]);
  });

  it("persists the collision-safe Projects order", async () => {
    const repo = makeRepository("projects", { twoItems: true }); open({ path: "/projects" }, repo.repository);
    await screen.findByLabelText("English Title");
    fireEvent.click(screen.getAllByRole("button", { name: "Move Example Analysis Project up" }).at(-1)!);
    save(); await screen.findByText("No unsaved changes");
    expect(repo.methods.updateEditableEntryPosition.mock.calls.filter(call=>call[0]==="projects").length).toBeGreaterThan(2);
  });

  it("confirms Project deletion and deletes translations before the real parent UUID", async () => {
    const repo = makeRepository("projects", { twoItems: true }); open({ path: "/projects" }, repo.repository);
    await screen.findByLabelText("English Title");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Example Analysis Project" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    save(); await screen.findByText("No unsaved changes");
    expect(repo.methods.deleteEditableTranslation).toHaveBeenCalledWith("projects", resumeId, "project-1-second", "zh");
    expect(repo.methods.deleteEditableEntry).toHaveBeenCalledWith("projects", resumeId, "project-1-second");
  });

  it("saves a project method value by project UUID, locale, and method UUID", async () => {
    const repo = makeRepository("projects");
    open({ path: "/projects" }, repo.repository);
    const method = await screen.findByLabelText("English methods 1");
    fireEvent.change(method, { target: { value: "Updated English method" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(repo.methods.updateProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "method-en-1", "en", { value: "Updated English method" });
  });

  it.each(["en", "zh"] as const)("Projects uses concise bilingual identity and localized add/save copy in %s UI", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const { repository, items } = makeRepository("projects", { twoItems: true });
    const projects = items as ProjectItem[];
    projects[1].translations[locale].title = "";
    projects[1].translations[locale === "zh" ? "en" : "zh"].title = locale === "zh" ? "Fallback English Project" : "备用中文项目";
    projects.push({ ...structuredClone(projects[0]), id: "project-no-title", sourceKey: "project-no-title", position: 2,
      translations: { zh: { ...projects[0].translations.zh, title: "" }, en: { ...projects[0].translations.en, title: "" } } });
    open({ path: "/projects" }, repository);

    const addName = locale === "zh" ? "添加项目经历" : "Add project";
    await screen.findByRole("button", { name: addName });
    const scope = document.querySelector(".projects-editor-scope")!;
    expect(scope.querySelector(".group-heading h2")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Projects items" })).toBeNull();
    expect(scope.textContent).not.toMatch(/Edit bilingual project details|编辑双语项目详情/);
    expect(Array.from(scope.querySelectorAll<HTMLElement>(".item-card-heading h3"), node => node.textContent)).toEqual(locale === "zh"
      ? ["示例分析项目", "Fallback English Project", "项目经历 3"]
      : ["Example Analysis Project", "备用中文项目", "Project 3"]);
    expect(screen.getByRole("heading", { name: locale === "zh" ? "方法" : "Methods" })).toBeTruthy();
    expect(screen.getByRole("button", { name: locale === "zh" ? "保存项目经历修改" : "Save project changes" })).toBeTruthy();
    expect(scope.querySelector(".production-save-helper")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: addName }));
    expect(Array.from(scope.querySelectorAll<HTMLElement>(".item-card-heading h3"), node => node.textContent).at(-1))
      .toBe(locale === "zh" ? "项目经历 4" : "Project 4");
  });

  it("keeps project URL as one shared field and writes it through the existing locale translation contract", async () => {
    const repo = makeRepository("projects"); open({ path: "/projects" }, repo.repository);
    const url = await screen.findByLabelText("Project URL");
    expect(screen.getAllByLabelText("Project URL")).toHaveLength(1);
    expect(screen.queryByLabelText("Chinese Project URL")).toBeNull();
    expect(screen.queryByLabelText("English Project URL")).toBeNull();
    fireEvent.change(url, { target: { value: "https://example.test/project" } });
    save();
    await screen.findByText("Project changes saved.");
    for (const locale of ["zh", "en"] as const) {
      expect(repo.methods.updateEditableTranslation).toHaveBeenCalledWith("projects", resumeId, "project-1", locale,
        expect.objectContaining({ href: "https://example.test/project" }));
    }
  });

  it("keeps methods aligned by order while their locale-specific actions stay independent", async () => {
    const repo = makeRepository("projects"); open({ path: "/projects" }, repo.repository);
    await screen.findByLabelText("English methods 1");
    const scope = document.querySelector(".projects-editor-scope")!;
    const methodsGrid = scope.querySelector<HTMLElement>(".methods-grid")!;
    expect(methodsGrid.dataset.methodListLayout).toBe("paired");
    expect(methodsGrid.classList.contains("is-adaptive-stacked")).toBe(false);
    const groups = Array.from(scope.querySelectorAll<HTMLElement>(".method-group"));
    expect(groups.map(group => group.querySelector("h4")?.textContent)).toEqual(["中文", "EN"]);
    expect(groups.map(group => Array.from(group.querySelectorAll(".method-row .field>label [aria-hidden=true]"), label => label.textContent))).toEqual([["01", "02"], ["01", "02"]]);
    expect(groups[0].querySelectorAll(".method-row")).toHaveLength(2);
    expect(groups[1].querySelectorAll(".method-row")).toHaveLength(2);
    expect(methodsGrid.querySelectorAll(".method-row.is-adaptive-stacked")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Move English methods 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Chinese methods 1" }));
    save(); await screen.findByText("No unsaved changes");
    expect(repo.methods.deleteProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "method-zh-1", "zh");
    expect(repo.methods.updateProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "method-en-2", "en", { position: expect.any(Number) });
  });

  it("keeps multiple Projects expanded through close and reorder", async () => {
    const { repository } = makeRepository("projects", { twoItems: true }); open({ path: "/projects" }, repository);
    await screen.findByLabelText("English Title");
    const scope = document.querySelector(".projects-editor-scope")!;
    const cards = Array.from(scope.querySelectorAll<HTMLElement>(".item-card"));
    fireEvent.click(cards[1].querySelector('.item-actions button[aria-label^="Edit"]')!);
    expect(scope.querySelectorAll(".item-card-body")).toHaveLength(2);
    fireEvent.click(cards[0].querySelector('.item-actions button[aria-label^="Close editor"]')!);
    expect(scope.querySelectorAll(".item-card-body")).toHaveLength(1);
    fireEvent.click(cards[0].querySelector('.item-actions button[aria-label^="Edit"]')!);
    fireEvent.click(cards[1].querySelector('.item-actions button[aria-label^="Move"]')!);
    expect(scope.querySelectorAll(".item-card-body")).toHaveLength(2);
  });

  it("keeps only one subtle divider between adjacent Projects and none around the last item, methods, or save bar", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".education-editor-scope .item-card + .item-card,.experience-editor-scope .item-card + .item-card,.projects-editor-scope .item-card + .item-card");
    expect(css).toContain(".education-editor-scope .item-card:last-child,.experience-editor-scope .item-card:last-child,.projects-editor-scope .item-card:last-child");
    expect(css).toContain(".projects-editor-scope .save-bar{border-top:0}");
    expect(css).toContain(".projects-editor-scope .method-group{background:transparent;border:0;border-radius:0;padding:0;gap:10px}");
  });

  it("creates Current Focus with the returned UUID and both locale translations", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Add focus" }));
    const title = (await screen.findAllByLabelText("Chinese Focus title")).at(-1)!;
    fireEvent.change(title, { target: { value: "关注新主题" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.insertFocus).toHaveBeenCalledOnce();
    expect(contact.methods.insertFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-production-id", "zh", { title: "关注新主题", detail: "" });
    expect(contact.methods.insertFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-production-id", "en", { title: "", detail: "" });
  });

  it("dispatches the exact dirty Contact + new Focus + zh/en title save reproduction", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Add focus" }));
    fireEvent.change((await screen.findAllByLabelText("Chinese Focus title")).at(-1)!, { target: { value: "1" } });
    fireEvent.change((await screen.findAllByLabelText("English Focus title")).at(-1)!, { target: { value: "2" } });

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: "Save contact changes" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    await screen.findByText("No unsaved changes");
    expect(await screen.findByText("Contact changes saved.")).toBeTruthy();
    expect(contact.methods.insertFocus).toHaveBeenCalledOnce();
    expect(contact.methods.insertFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-production-id", "zh", { title: "1", detail: "" });
    expect(contact.methods.insertFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-production-id", "en", { title: "2", detail: "" });
  });

  it.each(["zh", "en"] as const)("saves changed %s Contact Availability through the unified Contact save", async locale => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    const label = locale === "zh" ? "Chinese Availability" : "English Availability";
    const field = await screen.findByLabelText(label) as HTMLTextAreaElement;
    const value = locale === "zh" ? "已更新的中文可用状态" : "Updated English availability";
    fireEvent.change(field, { target: { value } });

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save contact changes" }));
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateContactAvailability).toHaveBeenCalledWith(resumeId, locale, value);
    expect(contact.methods.updateContactAvailability).toHaveBeenCalledOnce();
    expect(contact.methods.updateContactLabel).not.toHaveBeenCalled();
  });

  it("keeps Focus and Status items independently expanded by stable ID through reorder", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    const scope = document.querySelector(".contact-editor-scope")!;
    const focus = scope.querySelector('[aria-label="Current Focus"]') as HTMLElement;
    const status = scope.querySelector('[aria-label="Current Status"]') as HTMLElement;
    const focusCards = () => Array.from(focus.querySelectorAll<HTMLElement>(".item-card"));
    const statusCards = () => Array.from(status.querySelectorAll<HTMLElement>(".item-card"));

    fireEvent.click(within(focusCards()[1]).getByRole("button", { name: "Edit Projects & Practice" }));
    fireEvent.click(within(statusCards()[1]).getByRole("button", { name: "Edit Open to Discussions" }));
    expect(focus.querySelectorAll(".item-card-body")).toHaveLength(2);
    expect(status.querySelectorAll(".item-card-body")).toHaveLength(2);
    expect(Array.from(focus.querySelectorAll(".item-card-heading h3")).every(heading => !heading.classList.contains("visually-hidden"))).toBe(true);
    expect(Array.from(status.querySelectorAll(".item-card-heading h3")).every(heading => !heading.classList.contains("visually-hidden"))).toBe(true);
    expect(within(focusCards()[1]).getByRole("button", { name: "Close editor for Projects & Practice" })).toBeTruthy();
    expect(within(statusCards()[1]).getByRole("button", { name: "Close editor for Open to Discussions" })).toBeTruthy();

    fireEvent.click(within(statusCards()[1]).getByRole("button", { name: "Move Open to Discussions up" }));
    expect(statusCards().map(card => card.querySelector(".item-card-heading h3")?.textContent)).toEqual(["Open to Discussions", "Example Template"]);
    expect(statusCards().map(card => card.dataset.editorAnchor)).toEqual(["item:contact-status:status-2", "item:contact-status:status-1"]);

    fireEvent.click(within(focusCards()[1]).getByRole("button", { name: "Move Projects & Practice up" }));
    expect(focusCards().map(card => Boolean(card.querySelector(".item-card-body")))).toEqual([true, true]);
    expect(focusCards()[0].querySelector("input[id='focus-2-en-title']")).toBeTruthy();
    expect(status.querySelectorAll(".item-card-body")).toHaveLength(2);

    fireEvent.click(within(focusCards()[0]).getByRole("button", { name: "Close editor for Projects & Practice" }));
    expect(focus.querySelectorAll(".item-card-body")).toHaveLength(1);
    expect(status.querySelectorAll(".item-card-body")).toHaveLength(2);
    expect(focusCards()[0].querySelector(".item-card-heading h3")?.textContent).toBe("Projects & Practice");

    fireEvent.click(within(focusCards()[1]).getByRole("button", { name: "Delete Data & Analysis" }));
    fireEvent.click(within(focusCards()[1]).getByRole("button", { name: "Confirm delete" }));
    expect(focus.querySelectorAll(".item-card")).toHaveLength(1);
    expect(status.querySelectorAll(".item-card-body")).toHaveLength(2);
  });

  it.each(["en", "zh"] as const)("uses Contact-specific item and save labels in %s UI", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText(locale === "en" ? "English Section label" : "英文 部分标签");
    const scope = document.querySelector(".contact-editor-scope")!;
    expect(screen.queryByText("Manage public contact text, Current Focus, and Current Status.")).toBeNull();
    expect(scope.textContent).not.toMatch(/Not editable in the first CMS release|首个 CMS 版本暂不可编辑|production save|保存到生产环境/);
    expect(screen.getByRole("button", { name: locale === "en" ? "Add focus" : "添加关注" })).toBeTruthy();
    expect(screen.getByRole("button", { name: locale === "en" ? "Add status" : "添加状态" })).toBeTruthy();
    expect(screen.getByRole("button", { name: locale === "en" ? "Save contact changes" : "保存联系方式修改" })).toBeTruthy();
    expect(screen.getByText(locale === "en" ? "No unsaved changes" : "没有未保存修改")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: locale === "en" ? "Status type" : "状态类型" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Add focus" : "添加关注" }));
    expect(screen.getByRole("button", { name: locale === "en" ? "Close editor for Focus 3" : "关闭编辑器： 关注 3" })).toBeTruthy();
    const newFocus = Array.from(scope.querySelectorAll<HTMLElement>('[aria-label="Current Focus"] .item-card')).at(-1)!;
    expect(newFocus.querySelector(".item-card-heading h3")?.classList.contains("visually-hidden")).toBe(false);
    expect(within(newFocus).getByLabelText(locale === "en" ? "Chinese Focus title" : "中文 关注标题")).toBeTruthy();
    expect(within(newFocus).getByLabelText(locale === "en" ? "English Focus title" : "英文 关注标题")).toBeTruthy();
    fireEvent.click(within(newFocus).getByRole("button", { name: locale === "en" ? "Close editor for Focus 3" : "关闭编辑器： 关注 3" }));
    expect(newFocus.querySelector(".item-card-heading h3")?.textContent).toBe(locale === "en" ? "Focus 3" : "关注 3");
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Add status" : "添加状态" }));
    expect(screen.getByRole("button", { name: locale === "en" ? "Close editor for Status 3" : "关闭编辑器： 状态 3" })).toBeTruthy();
    const newStatus = Array.from(scope.querySelectorAll<HTMLElement>('[aria-label="Current Status"] .item-card')).at(-1)!;
    expect(newStatus.querySelector(".item-card-heading h3")?.classList.contains("visually-hidden")).toBe(false);
    expect(within(newStatus).getByRole("combobox", { name: locale === "en" ? "Status type" : "状态类型" })).toBeTruthy();
    expect(within(newStatus).getByLabelText(locale === "en" ? "Chinese Status title" : "中文 状态标题")).toBeTruthy();
    expect(within(newStatus).getByLabelText(locale === "en" ? "English Status title" : "英文 状态标题")).toBeTruthy();
    fireEvent.click(within(newStatus).getByRole("button", { name: locale === "en" ? "Close editor for Status 3" : "关闭编辑器： 状态 3" }));
    expect(newStatus.querySelector(".item-card-heading h3")?.textContent).toBe(locale === "en" ? "Status 3" : "状态 3");
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Cancel changes" : "取消修改" }));
    expect(screen.getByText(locale === "en" ? "No unsaved changes" : "没有未保存修改")).toBeTruthy();
    expect(scope.querySelectorAll('[aria-label="Current Focus"] .item-card')).toHaveLength(2);
    expect(scope.querySelectorAll('[aria-label="Current Status"] .item-card')).toHaveLength(2);
    expect(screen.queryByText(/reverted|恢复|已取消/)).toBeNull();
  });

  it("keeps Contact item dividers subtle, removes the save-area divider, and preserves keyboard focus", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".contact-editor-scope .item-card + .item-card{border-top:1px solid #eee}");
    expect(css).toContain(".contact-editor-scope .item-card:last-child{border-bottom:0}");
    expect(css).toContain(".contact-editor-scope .save-bar{border-top:0}");
    expect(css).toContain(".contact-editor-scope button:focus:not(:focus-visible)");
    expect(css).toContain(".contact-editor-scope button:focus-visible{outline:2px solid #77766f;outline-offset:2px}");
  });

  it.each(["en", "zh"] as const)("shows the live expanded Current Focus title in %s while keeping Cancel and Save behavior", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText(locale === "en" ? "English Section label" : "英文 部分标签");

    const focus = document.querySelector('[aria-label="Current Focus"]') as HTMLElement;
    const focusCard = focus.querySelector<HTMLElement>(".item-card")!;
    const focusTitle = focusCard.querySelector<HTMLElement>(".item-card-heading h3")!;
    const titleLabel = locale === "en" ? "English Focus title" : "中文 关注标题";
    const titleField = within(focusCard).getByLabelText(titleLabel) as HTMLInputElement;
    const originalTitle = locale === "en" ? "Data & Analysis" : "数据与分析";
    expect(focusTitle.classList.contains("visually-hidden")).toBe(false);
    expect(focusTitle.parentElement?.classList.contains("visually-hidden-containing-block")).toBe(false);
    expect(focusTitle.textContent).toBe(originalTitle);
    expect(within(focusCard).getByLabelText(locale === "en" ? "Chinese Focus title" : "英文 关注标题")).toBeTruthy();
    const focusLabel = focusCard.querySelector<HTMLLabelElement>('label[for="focus-1-zh-title"]')!;
    expect(focusLabel.classList.contains("visually-hidden-containing-block")).toBe(true);
    expect(focusLabel.querySelector(".visually-hidden")?.textContent).toBe(locale === "en" ? "Chinese Focus title" : "中文 关注标题");
    expect(focusLabel.querySelector('[aria-hidden="true"]')?.textContent).toBe("中文");
    expect(within(focusCard).getByRole("button", { name: locale === "en" ? "Close editor for Data & Analysis" : "关闭编辑器： 数据与分析" })).toBeTruthy();

    const changeTitle = (value: string) => fireEvent.change(titleField, { target: { value } });
    const currentLocaleTitle = locale === "en" ? "Data & Analysis updated" : "数据与分析已更新";
    changeTitle(currentLocaleTitle);
    expect(focusTitle.textContent).toBe(currentLocaleTitle);
    expect(screen.getByText(locale === "en" ? "Unsaved changes" : "有未保存修改")).toBeTruthy();

    const closeLabel = locale === "en" ? "Close editor for Data & Analysis updated" : "关闭编辑器： 数据与分析已更新";
    fireEvent.click(within(focusCard).getByRole("button", { name: closeLabel }));
    expect(focusCard.querySelector(".item-card-body")).toBeNull();
    expect(focusCard.querySelector(".item-card-heading h3")?.textContent).toBe(currentLocaleTitle);
    fireEvent.click(within(focusCard).getByRole("button", { name: locale === "en" ? "Edit Data & Analysis updated" : "编辑 数据与分析已更新" }));
    expect(focusCard.querySelector(".item-card-body")).toBeTruthy();
    expect(focusCard.querySelector(".item-card-heading h3")?.textContent).toBe(currentLocaleTitle);

    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Cancel changes" : "取消修改" }));
    expect((within(focusCard).getByLabelText(titleLabel) as HTMLInputElement).value).toBe(originalTitle);
    expect(focusTitle.textContent).toBe(originalTitle);
    expect(screen.getByText(locale === "en" ? "No unsaved changes" : "没有未保存修改")).toBeTruthy();

    const savedTitle = locale === "en" ? "Saved English focus" : "已保存的关注标题";
    fireEvent.change(within(focusCard).getByLabelText(titleLabel), { target: { value: savedTitle } });
    expect(focusTitle.textContent).toBe(savedTitle);
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Save contact changes" : "保存联系方式修改" }));
    await screen.findByText(locale === "en" ? "No unsaved changes" : "没有未保存修改");
    expect(contact.methods.updateFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-1", locale === "en" ? "en" : "zh", { title: savedTitle, detail: "" });
  });

  it.each(["en", "zh"] as const)("shows the live expanded Current Status title in %s and keeps type independent", async locale => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText(locale === "en" ? "English Section label" : "英文 部分标签");

    const status = document.querySelector('[aria-label="Current Status"]') as HTMLElement;
    const statusCard = status.querySelector<HTMLElement>(".item-card")!;
    const headerTitle = statusCard.querySelector<HTMLElement>(".item-card-heading h3")!;
    const titleLabel = locale === "en" ? "English Status title" : "中文 状态标题";
    const originalTitle = locale === "en" ? "Example Template" : "示例模板";
    const changedTitle = locale === "en" ? "Currently Studying" : "正在学习";
    expect(headerTitle.classList.contains("visually-hidden")).toBe(false);
    expect(headerTitle.textContent).toBe(originalTitle);
    expect(within(statusCard).getByRole("combobox", { name: locale === "en" ? "Status type" : "状态类型" })).toBeTruthy();
    expect(within(statusCard).getByLabelText(locale === "en" ? "Chinese Status title" : "英文 状态标题")).toBeTruthy();
    expect(within(statusCard).getByLabelText(titleLabel)).toBeTruthy();
    expect(within(statusCard).getByRole("button", { name: locale === "en" ? "Close editor for Example Template" : "关闭编辑器： 示例模板" })).toBeTruthy();

    fireEvent.change(within(statusCard).getByLabelText(titleLabel), { target: { value: changedTitle } });
    expect(headerTitle.textContent).toBe(changedTitle);

    const type = within(statusCard).getByRole("combobox", { name: locale === "en" ? "Status type" : "状态类型" });
    fireEvent.click(type);
    const listbox = screen.getByRole("listbox", { name: locale === "en" ? "Status type" : "状态类型" });
    expect(within(listbox).getByRole("option", { name: locale === "en" ? "Study" : "学习" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: locale === "en" ? "Graduation" : "毕业" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: locale === "en" ? "Open" : "开放" })).toBeTruthy();
    fireEvent.click(within(listbox).getByRole("option", { name: locale === "en" ? "Graduation" : "毕业" }));
    expect(headerTitle.textContent).toBe(changedTitle);
    expect(screen.getByText(locale === "en" ? "Unsaved changes" : "有未保存修改")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Cancel changes" : "取消修改" }));
    expect((within(statusCard).getByLabelText(titleLabel) as HTMLInputElement).value).toBe(originalTitle);
    expect(headerTitle.textContent).toBe(originalTitle);
    expect(within(statusCard).getByRole("combobox", { name: locale === "en" ? "Status type" : "状态类型" }).textContent).toBe(locale === "en" ? "Study" : "学习");
    expect(contact.methods.updateStatusType).not.toHaveBeenCalled();

    fireEvent.click(within(statusCard).getByRole("button", { name: locale === "en" ? "Close editor for Example Template" : "关闭编辑器： 示例模板" }));
    expect(statusCard.querySelector(".item-card-body")).toBeNull();
    expect(headerTitle.textContent).toBe(originalTitle);
    fireEvent.click(within(statusCard).getByRole("button", { name: locale === "en" ? "Edit Example Template" : "编辑 示例模板" }));
    expect(statusCard.querySelector(".item-card-body")).toBeTruthy();
    expect(headerTitle.textContent).toBe(originalTitle);

    const savedTitle = locale === "en" ? "Saved Status Title" : "已保存状态标题";
    fireEvent.change(within(statusCard).getByLabelText(titleLabel), { target: { value: savedTitle } });
    expect(headerTitle.textContent).toBe(savedTitle);
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Save contact changes" : "保存联系方式修改" }));
    await screen.findByText(locale === "en" ? "No unsaved changes" : "没有未保存修改");
    expect(contact.methods.updateStatusTranslation).toHaveBeenCalledWith(resumeId, "status-1", locale, expect.objectContaining({ title: savedTitle }));
    expect(contact.methods.updateStatusType).not.toHaveBeenCalled();
  });

  it("keeps expanded summary headings for repeatable editors outside Contact", async () => {
    const experience = makeRepository("experience");
    open({ path: "/experience" }, experience.repository);
    await screen.findByLabelText("English Organization");
    const card = document.querySelector(".experience-editor-scope .item-card") as HTMLElement;
    expect(card.querySelector(".item-card-body")).toBeTruthy();
    expect(card.querySelector(".item-card-heading h3")?.textContent).toBe("Example Technology Company");
  });

  it("creates Focus, then deletes the production UUID in the same mounted session", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Add focus" }));
    fireEvent.change((await screen.findAllByLabelText("Chinese Focus title")).at(-1)!, { target: { value: "New focus lifecycle" } });
    save();
    await screen.findByText("No unsaved changes");

    fireEvent.click(screen.getByRole("button", { name: "Edit New focus lifecycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete New focus lifecycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    save();
    await screen.findByText("No unsaved changes");

    expect(contact.methods.deleteFocus).toHaveBeenCalledWith(resumeId, "focus-production-id");
    expect(contact.methods.insertFocus).toHaveBeenCalledOnce();
  });

  it("deletes a previously persisted Focus UUID after a fresh route load", async () => {
    const contact = makeRepository("skills");
    contact.repository.loadContact = vi.fn().mockResolvedValue({
      ...structuredClone(fixtureSections.contact),
      focus: [...structuredClone(fixtureSections.contact.focus), {
        id: "focus-production-id", position: 2,
        translations: { zh: { title: "Persisted Focus", detail: "" }, en: { title: "Persisted Focus", detail: "" } },
      }],
    });
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Delete Persisted Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.deleteFocus).toHaveBeenCalledWith(resumeId, "focus-production-id");
  });

  it("edits a just-created Focus by its production UUID on the second save", async () => {
    const contact = makeRepository("skills");
    const { store } = open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Add focus" }));
    fireEvent.change((await screen.findAllByLabelText("Chinese Focus title")).at(-1)!, { target: { value: "Created focus" } });
    save();
    await screen.findByText("No unsaved changes");

    fireEvent.click(screen.getByRole("button", { name: /Edit Created focus/ }));
    const createdFocus = screen.getByRole("button", { name: /Close editor for Created focus/ }).closest("article")!;
    fireEvent.change(within(createdFocus).getByLabelText("Chinese Focus title"), { target: { value: "Edited after create" } });
    save();
    await screen.findByText("No unsaved changes");

    expect(contact.methods.updateFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-production-id", "zh", { title: "Edited after create", detail: "" });
    expect(contact.methods.insertFocus).toHaveBeenCalledOnce();
    const cached = store.getSectionState("batch6a-session", resumeId, "contact");
    expect(cached.status).toBe("loaded");
    if (cached.status === "loaded") expect(cached.value.focus.find(item => item.translations.zh.title === "Edited after create")?.id).toBe("focus-production-id");
  });

  it("retries a rejected Focus write and releases the save guard after settlement", async () => {
    const contact = makeRepository("skills");
    contact.methods.updateContactLabel.mockRejectedValueOnce(new Error("temporary Contact failure"));
    open({ path: "/contact" }, contact.repository);
    fireEvent.change(await screen.findByLabelText("English Section label"), { target: { value: "Retryable Contact" } });
    save();
    await screen.findByRole("alert");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateContactLabel).toHaveBeenCalledTimes(2);
  });

  it("keeps duplicate Contact submissions blocked only while the save is in flight", async () => {
    const contact = makeRepository("skills");
    let resolveWrite!: (value: { resumeId: string; locale: Locale; contactLabel: string }) => void;
    contact.methods.updateContactLabel.mockImplementationOnce(() => new Promise(resolve => { resolveWrite = resolve; }));
    open({ path: "/contact" }, contact.repository);
    const field = await screen.findByLabelText("English Section label");
    fireEvent.change(field, { target: { value: "In-flight Contact" } });
    save();
    fireEvent.submit(field.closest("form")!);
    expect(contact.methods.updateContactLabel).toHaveBeenCalledOnce();
    resolveWrite({ resumeId, locale: "en", contactLabel: "In-flight Contact" });
    await screen.findByText("No unsaved changes");

    fireEvent.change(screen.getByLabelText("English Section label"), { target: { value: "After settled" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateContactLabel).toHaveBeenCalledTimes(2);
  });

  it("creates, edits, and deletes Current Status using its production UUID", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Add status" }));
    fireEvent.change((await screen.findAllByLabelText("Chinese Status title")).at(-1)!, { target: { value: "New status lifecycle" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.insertStatusTranslation).toHaveBeenCalledWith(resumeId, "status-production-id", "zh", { title: "New status lifecycle", detail: "" });

    fireEvent.click(screen.getByRole("button", { name: /Edit New status lifecycle/ }));
    const createdStatus = screen.getByRole("button", { name: /Close editor for New status lifecycle/ }).closest("article")!;
    fireEvent.change(within(createdStatus).getByLabelText("English Status title"), { target: { value: "Updated status" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateStatusTranslation).toHaveBeenCalledWith(resumeId, "status-production-id", "en", { title: "Updated status", detail: "" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Updated status" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.deleteStatus).toHaveBeenCalledWith(resumeId, "status-production-id");
    expect(contact.methods.insertStatus).toHaveBeenCalledOnce();
  });

  it("confirms Focus deletion and persists the remaining item order", async () => {
    const contact = makeRepository("skills", { twoItems: true }); open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Move Projects & Practice up" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Data & Analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    save(); await screen.findByText("No unsaved changes");
    expect(contact.methods.deleteFocus).toHaveBeenCalledWith(resumeId, "focus-1");
    expect(contact.methods.updateFocusPosition).toHaveBeenCalledWith(resumeId, "focus-2", expect.any(Number));
  });

  it("recovers a partial Status create without duplicating its parent or zh translation", async () => {
    const contact = makeRepository("skills"); open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getByRole("button", { name: "Add status" }));
    fireEvent.change(screen.getAllByLabelText("Chinese Status title").at(-1)!, { target: { value: "新状态" } });
    contact.methods.insertStatusTranslation.mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(new Error("temporary en write failure"));
    save(); await screen.findByRole("alert");
    expect(contact.methods.insertStatus).toHaveBeenCalledOnce();
    save(); await screen.findByText("No unsaved changes");
    expect(contact.methods.insertStatus).toHaveBeenCalledOnce();
    expect(contact.methods.insertStatusTranslation.mock.calls.map(call=>call[2])).toEqual(["zh", "en", "en"]);
  });

  it("persists Focus and Status translations and preserves status type unless explicitly changed", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    fireEvent.change(await screen.findByLabelText("English Focus title"), { target: { value: "Analytics focus" } });
    fireEvent.change(screen.getAllByLabelText("Chinese Detail")[0], { target: { value: "焦点详情" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-1", "en", { title: "Analytics focus", detail: "" });
    expect(contact.methods.updateFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-1", "zh", { title: "数据与分析", detail: "焦点详情" });
    fireEvent.change(screen.getAllByLabelText("English Detail")[1], { target: { value: "Status details" } });
    chooseStatusType(0, "Graduation");
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateStatusTranslation).toHaveBeenCalledWith(resumeId, "status-1", "en", { title: "Example Template", detail: "Status details" });
    expect(contact.methods.updateStatusType).toHaveBeenCalledWith(resumeId, "status-1", "graduation");
  });

  it("keeps a failed Contact translation dirty and retries it", async () => {
    const contact = makeRepository("skills"); contact.methods.updateContactLabel.mockRejectedValueOnce(new Error("temporary Contact failure"));
    open({ path: "/contact" }, contact.repository);
    fireEvent.change(await screen.findByLabelText("English Section label"), { target: { value: "Retry Contact" } });
    save(); await screen.findByRole("alert");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save(); await screen.findByText("No unsaved changes");
    expect(contact.methods.updateContactLabel).toHaveBeenCalledTimes(2);
  });

  it("persists Contact and Links changes through their scoped writers", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    fireEvent.change(await screen.findByLabelText("English Section label"), { target: { value: "Contact section" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateContactLabel).toHaveBeenCalledWith(resumeId, "en", "Contact section");
    cleanup();
    const links = makeRepository("skills");
    open({ path: "/links" }, links.repository);
    fireEvent.change(await screen.findByLabelText("URL"), { target: { value: "https://github.example.test/changed" } });
    const linkGroups = document.querySelectorAll(".links-object-group");
    fireEvent.change(within(linkGroups[0] as HTMLElement).getByLabelText("Contact label"), { target: { value: "Email contact" } });
    fireEvent.change(within(linkGroups[2] as HTMLElement).getByLabelText("Display name"), { target: { value: "LinkedIn name" } });
    fireEvent.change(within(linkGroups[2] as HTMLElement).getAllByLabelText("Hero button label")[0], { target: { value: "LinkedIn hero" } });
    fireEvent.change(screen.getByLabelText("English Contact label"), { target: { value: "LinkedIn contact" } });
    fireEvent.change(screen.getByLabelText("LinkedIn URL"), { target: { value: "https://linkedin.example.test/profile" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(links.methods.updatePublicLinks).toHaveBeenCalledWith(resumeId, {
      emailLabel: "Email contact", github: "https://github.example.test/changed", linkedInDisplayName: "LinkedIn name", linkedInLabel: "LinkedIn hero",
    });
    expect(links.methods.updateSiteText).toHaveBeenCalledWith(resumeId, "zh", { linkedInHref: "https://linkedin.example.test/profile" });
    expect(links.methods.updateSiteText).toHaveBeenCalledWith(resumeId, "en", { linkedInLabel: "LinkedIn contact", linkedInHref: "https://linkedin.example.test/profile" });
    cleanup();
    const siteText = makeRepository("skills");
    open({ path: "/links" }, siteText.repository);
    expect(await screen.findByLabelText("English Updated-at label")).toBeTruthy();
    expect(screen.queryByLabelText("English Education section title")).toBeNull();
    fireEvent.change(screen.getByLabelText("English Public button label"), { target: { value: "Download CV" } });
    fireEvent.change(screen.getByLabelText("Chinese Experience"), { target: { value: "经历（更新）" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(siteText.methods.updateSiteText).toHaveBeenCalledWith(resumeId, "en", { portfolioLabel: "Download CV" });
    expect(siteText.methods.updateNavigationLabel).toHaveBeenCalledWith(resumeId, expect.any(String), "zh", "经历（更新）");
  });

  it("preserves differing legacy LinkedIn URLs until the single shared URL control is explicitly edited", async () => {
    const links = makeRepository("skills");
    const legacyLinks = structuredClone(fixtureSections.links);
    legacyLinks.translations.zh.linkedInHref = "https://zh.example.test/profile";
    legacyLinks.translations.en.linkedInHref = "https://en.example.test/profile";
    links.repository.loadLinks = vi.fn().mockResolvedValue(legacyLinks);
    open({ path: "/links" }, links.repository);

    const sharedUrl = await screen.findByLabelText("LinkedIn URL") as HTMLInputElement;
    expect(sharedUrl.value).toBe("https://zh.example.test/profile");
    const legacyUrlNotice = "The saved Chinese and English LinkedIn URLs differ. Editing this field will synchronize them on save.";
    expect(screen.getByText(legacyUrlNotice)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "changed@example.test" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(links.methods.updateSiteText).not.toHaveBeenCalled();
    expect(legacyLinks.translations.zh.linkedInHref).toBe("https://zh.example.test/profile");
    expect(legacyLinks.translations.en.linkedInHref).toBe("https://en.example.test/profile");

    fireEvent.change(screen.getByLabelText("LinkedIn URL"), { target: { value: "https://cancelled.example.test/profile" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("LinkedIn URL") as HTMLInputElement).value).toBe("https://zh.example.test/profile");
    expect(screen.getByText(legacyUrlNotice)).toBeTruthy();
    expect(links.methods.updateSiteText).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("LinkedIn URL"), { target: { value: "https://shared.example.test/profile" } });
    expect(screen.getByText(legacyUrlNotice)).toBeTruthy();
    save();
    await screen.findByText("No unsaved changes");
    expect(screen.queryByText(legacyUrlNotice)).toBeNull();
    expect(links.methods.updateSiteText.mock.calls).toEqual([
      [resumeId, "zh", { linkedInHref: "https://shared.example.test/profile" }],
      [resumeId, "en", { linkedInHref: "https://shared.example.test/profile" }],
    ]);
  });

  it("saves a PDF after SPA navigation with only the canonical resume ID available", async () => {
    const { repository, methods } = makeRepository("skills");
    const savedPdfUrl = "https://storage.example.test/example-cv/resume_zh.pdf?cacheNonce=spa-fallback";
    methods.uploadResumePdf.mockResolvedValueOnce(savedPdfUrl);
    const canonicalResume: LoadedResume = {
      resumeId,
      siteKey: "example-cv",
      isPublished: true,
      updatedAt: null,
      sections: structuredClone(fixtureSections),
    };
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/overview"]}>
      <NavigateToLinks />
      <App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError=""
        resume={canonicalResume} repository={repository} />
    </MemoryRouter></UiLocaleProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Open Links" }));
    const file = new File(["%PDF-1.7 test"], "spa-resume-zh.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Chinese Resume PDF"), { target: { files: [file] } });

    expect(screen.getByText("Selected: spa-resume-zh.pdf")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save site & link changes" }).hasAttribute("disabled")).toBe(false);
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();

    save();

    await screen.findByText("Site & link changes saved.");
    expect(methods.uploadResumePdf).toHaveBeenCalledTimes(1);
    expect(methods.uploadResumePdf).toHaveBeenCalledWith("zh", file);
    expect(methods.updateSiteText).toHaveBeenCalledWith(resumeId, "zh", { portfolioHref: savedPdfUrl });
    expect(screen.getByRole("link", { name: "Current PDF: spa-resume-zh.pdf" }).getAttribute("href")).toBe(savedPdfUrl);
    expect(screen.queryByText("Selected: spa-resume-zh.pdf")).toBeNull();
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it.each([
    ["zh", "Chinese Resume PDF", "费湘淞_中文简历.pdf"],
    ["en", "English Resume PDF", "Fei_XiangSong_English_Resume.pdf"],
  ] as const)("keeps a valid %s PDF selection as a draft and saves its stable public URL only on Save", async (locale, inputName, filename) => {
    const { repository, methods } = makeRepository("skills");
    const savedPdfUrl = `https://storage.example.test/example-cv/resume_${locale}.pdf?cacheNonce=saved-version`;
    methods.uploadResumePdf.mockResolvedValueOnce(savedPdfUrl);
    open({ path: "/links" }, repository);
    const input = await screen.findByLabelText(inputName);
    const file = new File(["%PDF-1.7 test"], filename, { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(`Selected: ${filename}`)).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save site & link changes" }).hasAttribute("disabled")).toBe(false);
    save();
    await screen.findByText("Site & link changes saved.");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(methods.uploadResumePdf).toHaveBeenCalledWith(locale, file);
    expect(methods.updateSiteText).toHaveBeenCalledWith(resumeId, locale, {
      portfolioHref: savedPdfUrl,
    });
    expect(new URL(savedPdfUrl).pathname).toBe(`/example-cv/resume_${locale}.pdf`);
    expect(screen.getByRole("link", { name: `Current PDF: ${filename}` }).getAttribute("href")).toBe(savedPdfUrl);
    expect(screen.queryByText(`Selected: ${filename}`)).toBeNull();
  });

  it("marks both pending PDF locales dirty and Cancel discards them without uploading", async () => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    const chinese = new File(["%PDF zh"], "draft-zh.pdf", { type: "application/pdf" });
    const english = new File(["%PDF en"], "draft-en.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Chinese Resume PDF"), { target: { files: [chinese] } });
    fireEvent.change(screen.getByLabelText("English Resume PDF"), { target: { files: [english] } });

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save site & link changes" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("Selected: draft-zh.pdf")).toBeTruthy();
    expect(screen.getByText("Selected: draft-en.pdf")).toBeTruthy();
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));

    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.queryByText("Selected: draft-zh.pdf")).toBeNull();
    expect(screen.queryByText("Selected: draft-en.pdf")).toBeNull();
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();
  });

  it("Cancel restores confirmed metadata filenames independently for Chinese and English", async () => {
    const { repository, methods } = makeRepository("skills");
    const confirmed = structuredClone(fixtureSections.links);
    confirmed.resumePdfFilenames = { zh: "费湘淞_中文简历.pdf", en: "Fei_XiangSong_Resume.pdf" };
    repository.loadLinks = vi.fn().mockResolvedValue(confirmed);
    open({ path: "/links" }, repository);
    expect(await screen.findByRole("link", { name: "Current PDF: 费湘淞_中文简历.pdf" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Current PDF: Fei_XiangSong_Resume.pdf" })).toBeTruthy();

    fireEvent.change(await screen.findByLabelText("Chinese Resume PDF"), {
      target: { files: [new File(["%PDF"], "测试新版.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByText("Selected: 测试新版.pdf")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Current PDF: 费湘淞_中文简历.pdf" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));

    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.queryByText("Selected: 测试新版.pdf")).toBeNull();
    expect(screen.getByRole("link", { name: "Current PDF: 费湘淞_中文简历.pdf" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Current PDF: Fei_XiangSong_Resume.pdf" })).toBeTruthy();
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();
  });

  it.each([
    ["non-PDF MIME type", new File(["text"], "resume.txt", { type: "text/plain" }), "Resume PDF must be a PDF file."],
    ["file over 10 MB", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }), "Resume PDF must be 10 MB or smaller."],
  ])("rejects a %s selection without uploading", async (_name, file, message) => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    fireEvent.change(await screen.findByLabelText("Chinese Resume PDF"), { target: { files: [file] } });
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();
  });

  it("localizes PDF validation errors in the Chinese admin UI", async () => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    await screen.findByRole("button", { name: "English" });
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    fireEvent.change(await screen.findByLabelText("中文 简历 PDF"), {
      target: { files: [new File(["not pdf"], "resume.txt", { type: "text/plain" })] },
    });
    expect((await screen.findByRole("alert")).textContent).toBe("简历文件必须是 PDF 格式。");
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();
  });

  it("keeps the PDF draft dirty and reports upload failure without writing an invalid href", async () => {
    const { repository, methods } = makeRepository("skills");
    methods.uploadResumePdf.mockRejectedValueOnce(new Error("Resume PDF upload failed."));
    open({ path: "/links" }, repository);
    fireEvent.change(await screen.findByLabelText("Chinese Resume PDF"), {
      target: { files: [new File(["%PDF"], "resume.pdf", { type: "application/pdf" })] },
    });
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("Resume PDF upload failed.");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByText("Selected: resume.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save site & link changes" }).hasAttribute("disabled")).toBe(false);
    expect(methods.updateSiteText).not.toHaveBeenCalledWith(resumeId, "zh", expect.objectContaining({ portfolioHref: expect.any(String) }));
    save();
    await screen.findByText("Site & link changes saved.");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(methods.uploadResumePdf).toHaveBeenCalledTimes(2);
    expect(methods.updateSiteText).toHaveBeenCalledWith(resumeId, "zh", {
      portfolioHref: "https://storage.example.test/example-cv/resume_zh.pdf?cacheNonce=repository-version",
    });
  });

  it("retains a selected PDF after persistence failure and retries the upload/save", async () => {
    const { repository, methods } = makeRepository("skills");
    methods.updateSiteText.mockRejectedValueOnce(new Error("temporary site text failure"));
    open({ path: "/links" }, repository);
    const file = new File(["%PDF"], "retryable-en.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("English Resume PDF"), { target: { files: [file] } });

    save();
    expect((await screen.findByRole("alert")).textContent).toBe("temporary site text failure");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByText("Selected: retryable-en.pdf")).toBeTruthy();
    expect(methods.uploadResumePdf).toHaveBeenCalledTimes(1);

    save();
    await screen.findByText("Site & link changes saved.");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(methods.uploadResumePdf).toHaveBeenCalledTimes(2);
    expect(methods.updateSiteText).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Current PDF: retryable-en.pdf" }).getAttribute("href")).toBe("https://storage.example.test/example-cv/resume_en.pdf?cacheNonce=repository-version");
  });

  it("retains selected PDF files across route navigation until Save or Cancel", async () => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    const file = new File(["%PDF"], "keep-this-draft.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("English Resume PDF"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("link", { name: "Site & Links" }));
    expect(await screen.findByText("Selected: keep-this-draft.pdf")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.uploadResumePdf).toHaveBeenCalledWith("en", file);
  });

  it("preserves existing PDF hrefs and saves unrelated Links fields without uploading", async () => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    fireEvent.change(await screen.findByLabelText("URL"), { target: { value: "https://github.example.test/updated" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();
    expect(methods.updatePublicLinks).toHaveBeenCalledWith(resumeId, { github: "https://github.example.test/updated" });
    expect(methods.updateSiteText).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Chinese Resume PDF") as HTMLInputElement).files).toHaveLength(0);
    expect((screen.getByLabelText("English Resume PDF") as HTMLInputElement).files).toHaveLength(0);
  });

  it.each([
    ["Projects", "/projects", "Chinese Title"],
    ["Contact", "/contact", "Chinese Section label"],
    ["Links & Site Text", "/links", "Email address"],
  ] as const)("shows production save for %s", async (_title, path, label) => {
    const repo = makeRepository("skills");
    const route = { path }; 
    open(route, repo.repository);
    const field = await screen.findByLabelText(label);
    fireEvent.change(field, { target: { value: label === "Email address" ? "local.only@example.test" : "Local only change" } });
    expect(screen.getByRole("button", { name: _title === "Projects" ? "Save project changes" : _title === "Contact" ? "Save contact changes" : "Save site & link changes" })).toBeTruthy();
    expect(repo.methods.updateEditableTranslation).not.toHaveBeenCalled();
    expect(repo.methods.insertEditableEntry).not.toHaveBeenCalled();
    expect(repo.methods.deleteEditableEntry).not.toHaveBeenCalled();
  });

});
