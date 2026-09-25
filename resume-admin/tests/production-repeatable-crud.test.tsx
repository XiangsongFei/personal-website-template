import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { fixtureSections } from "../src/fixtures";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import type { ResumeRepository, ResumeSectionRepository, EditableRepeatableSection } from "../src/data/resumeRepository";
import type { ExperienceItem, IntroItem, SkillItem, AwardItem, Locale, StatusItem } from "../src/model";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "batch6a-resume-id";
const cases = [
  { section: "introduction", path: "/introduction", title: "Introduction", input: "Chinese Paragraph", english: "English Paragraph", first: "这是一个双语个人网站模板。", changed: "已修改的中文段落", tableCount: 2 },
  { section: "experience", path: "/experience", title: "Experience", input: "Chinese Organization", english: "English Organization", first: "示例科技公司", changed: "已修改的中文组织", tableCount: 1 },
  { section: "skills", path: "/skills", title: "Skills", input: "Chinese Group title", english: "English Group title", first: "编程", changed: "已修改的中文分组", tableCount: 2 },
  { section: "awards", path: "/awards", title: "Awards", input: "Chinese Award name", english: "English Award name", first: "示例项目成果", changed: "已修改的中文荣誉", tableCount: 2 },
] as const;
type Case = typeof cases[number];
type TestSection = Case["section"] | "projects";
type Item = IntroItem | ExperienceItem | SkillItem | AwardItem;

function auth(): AdminAuthClient {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin", email: "admin@example.test", sessionKey: "batch6a-session" }),
    isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(async () => listener?.("SIGNED_OUT", null)),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }) };
}
function makeRepository(section: TestSection, options: { twoItems?: boolean; failEnOnce?: boolean; failUpdateOnce?: boolean } = {}) {
  const original = structuredClone(fixtureSections[section]) as unknown as Item[];
  const items = options.twoItems ? [...original, { ...structuredClone(original[0]), id: `${original[0].id}-second`, position: original.length } as Item] : original;
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
    uploadResumePdf: vi.fn(async (locale: Locale) => `https://storage.example.test/example-cv/resume_${locale}.pdf`),
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
function open(spec: { path: string }, repository: ResumeRepository, store = new ResumeSectionStore(), strict = false) {
  const tree = <UiLocaleProvider><MemoryRouter initialEntries={[spec.path]}><AuthGate client={auth()} resumeRepository={repository} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{tree}</StrictMode> : tree), store };
}
function save() { fireEvent.click(screen.getByRole("button", { name: "Save production changes" })); }
async function waitForField(id: string): Promise<HTMLInputElement | HTMLTextAreaElement> {
  await waitFor(() => expect(document.getElementById(id)).toBeTruthy());
  return document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
}
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Batch 6A production repeatable CRUD", () => {
  it.each([
    ...cases.map(({ path, section }) => ({ path, section })),
    { path: "/projects", section: "projects" as const },
  ])("renders the helper before the sticky save bar on $path", async ({ path, section }) => {
    const { repository } = makeRepository(section);
    open({ path }, repository);
    await screen.findByRole("button", { name: "Save production changes" });
    const page = document.querySelector(".page-section")!;
    const helper = page.querySelector(".production-save-helper")!;
    const saveBar = page.querySelector(".save-bar")!;
    expect(Array.from(page.children).indexOf(helper)).toBeLessThan(Array.from(page.children).indexOf(saveBar));
    expect(page.classList.contains("production-save-tail")).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getAllByLabelText(spec.input).at(-1)!, { target: { value: "Unconfirmed parent" } });
    save();
    await screen.findByRole("alert");
    expect(methods.insertEditableEntry).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Save production changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(cases)("$title drafts survive internal navigation and UI-language switching without browser storage", async spec => {
    const { repository, methods } = makeRepository(spec.section);
    const store = new ResumeSectionStore();
    open(spec, repository, store);
    const field = await screen.findByLabelText(spec.input) as HTMLInputElement | HTMLTextAreaElement;
    const fieldId = field.id;
    fireEvent.change(field, { target: { value: `Unsaved ${spec.title} draft` } });
    expect(window.sessionStorage.length).toBe(0);
    const other = spec.section === "awards" ? "Introduction" : "Awards";
    fireEvent.click(screen.getByRole("link", { name: other }));
    await screen.findByRole("heading", { name: other });
    fireEvent.click(screen.getByRole("link", { name: spec.title }));
    const returnedField = await waitForField(fieldId);
    expect(returnedField.value).toBe(`Unsaved ${spec.title} draft`);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect((document.getElementById(fieldId) as HTMLInputElement | HTMLTextAreaElement).value).toBe(`Unsaved ${spec.title} draft`);
    fireEvent.click(screen.getByRole("button", { name: "保存到生产环境" }));
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
    fireEvent.click(screen.getAllByRole("button", { name: "Add method" })[0]);
    fireEvent.change(await screen.findByLabelText("Chinese methods 3"), { target: { value: "新方法" } });
    save(); await screen.findByText("No unsaved changes");
    expect(repo.methods.insertProjectMethod).toHaveBeenCalledWith(resumeId, "project-1", "zh", 2, "新方法");
    expect(repo.methods.updateProjectMethod).not.toHaveBeenCalledWith(resumeId, "project-1", expect.stringMatching(/^local-method-/), expect.anything(), expect.anything());
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
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
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

  it("creates Current Focus with the returned UUID and both locale translations", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
    const title = await screen.findByLabelText("Chinese Focus title");
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
    fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
    fireEvent.change(await screen.findByLabelText("Chinese Focus title"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("English Focus title"), { target: { value: "2" } });

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: "Save production changes" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    await screen.findByText("No unsaved changes");
    expect(contact.methods.insertFocus).toHaveBeenCalledOnce();
    expect(contact.methods.insertFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-production-id", "zh", { title: "1", detail: "" });
    expect(contact.methods.insertFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-production-id", "en", { title: "2", detail: "" });
  });

  it("creates Focus, then deletes the production UUID in the same mounted session", async () => {
    const contact = makeRepository("skills");
    open({ path: "/contact" }, contact.repository);
    await screen.findByLabelText("English Section label");
    fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
    fireEvent.change(await screen.findByLabelText("Chinese Focus title"), { target: { value: "New focus lifecycle" } });
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
    fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
    fireEvent.change(await screen.findByLabelText("Chinese Focus title"), { target: { value: "Created focus" } });
    save();
    await screen.findByText("No unsaved changes");

    fireEvent.click(screen.getByRole("button", { name: "Edit Created focus" }));
    fireEvent.change(screen.getByLabelText("Chinese Focus title"), { target: { value: "Edited after create" } });
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
    fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[1]);
    fireEvent.change(await screen.findByLabelText("Chinese Status title"), { target: { value: "New status lifecycle" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.insertStatusTranslation).toHaveBeenCalledWith(resumeId, "status-production-id", "zh", { title: "New status lifecycle", detail: "" });

    fireEvent.click(screen.getByRole("button", { name: "Edit New status lifecycle" }));
    fireEvent.change(screen.getByLabelText("English Status title"), { target: { value: "Updated status" } });
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
    fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[1]);
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
    save();
    await screen.findByText("No unsaved changes");
    expect(contact.methods.updateFocusTranslation).toHaveBeenCalledWith(resumeId, "focus-1", "en", { title: "Analytics focus", detail: "" });
    fireEvent.change(screen.getByLabelText("Status type (shared)"), { target: { value: "graduation" } });
    save();
    await screen.findByText("No unsaved changes");
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
    fireEvent.change(await screen.findByLabelText("GitHub URL"), { target: { value: "https://github.example.test/changed" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(links.methods.updatePublicLinks).toHaveBeenCalledWith(resumeId, { github: "https://github.example.test/changed" });
    cleanup();
    const siteText = makeRepository("skills");
    open({ path: "/links" }, siteText.repository);
    fireEvent.change(await screen.findByLabelText("English Education heading"), { target: { value: "Learning" } });
    fireEvent.change(screen.getAllByLabelText("Chinese Navigation label")[0], { target: { value: "经历（更新）" } });
    save();
    await screen.findByText("No unsaved changes");
    expect(siteText.methods.updateSiteText).toHaveBeenCalledWith(resumeId, "en", { educationLabel: "Learning" });
    expect(siteText.methods.updateNavigationLabel).toHaveBeenCalledWith(resumeId, expect.any(String), "zh", "经历（更新）");
  });

  it.each([
    ["zh", "Chinese Resume PDF", "resume_zh.pdf"],
    ["en", "English Resume PDF", "resume_en.pdf"],
  ] as const)("keeps a valid %s PDF selection as a draft and saves its stable public URL only on Save", async (locale, inputName, filename) => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    const input = await screen.findByLabelText(inputName);
    const file = new File(["%PDF-1.7 test"], filename, { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(`Selected: ${filename}`)).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(methods.uploadResumePdf).not.toHaveBeenCalled();
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.uploadResumePdf).toHaveBeenCalledWith(locale, file);
    expect(methods.updateSiteText).toHaveBeenCalledWith(resumeId, locale, {
      portfolioHref: `https://storage.example.test/example-cv/resume_${locale}.pdf`,
    });
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
    expect(methods.updateSiteText).not.toHaveBeenCalledWith(resumeId, "zh", expect.objectContaining({ portfolioHref: expect.any(String) }));
  });

  it("retains selected PDF files across route navigation until Save or Cancel", async () => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    const file = new File(["%PDF"], "keep-this-draft.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("English Resume PDF"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("link", { name: "Links & Site Text" }));
    expect(await screen.findByText("Selected: keep-this-draft.pdf")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save();
    await screen.findByText("No unsaved changes");
    expect(methods.uploadResumePdf).toHaveBeenCalledWith("en", file);
  });

  it("preserves existing PDF hrefs and saves unrelated Links fields without uploading", async () => {
    const { repository, methods } = makeRepository("skills");
    open({ path: "/links" }, repository);
    fireEvent.change(await screen.findByLabelText("GitHub URL"), { target: { value: "https://github.example.test/updated" } });
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
    expect(screen.getByRole("button", { name: "Save production changes" })).toBeTruthy();
    expect(repo.methods.updateEditableTranslation).not.toHaveBeenCalled();
    expect(repo.methods.insertEditableEntry).not.toHaveBeenCalled();
    expect(repo.methods.deleteEditableEntry).not.toHaveBeenCalled();
  });

});
