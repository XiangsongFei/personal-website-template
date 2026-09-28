import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { mapResumeRows } from "../src/data/resumeMapper";
import type { ResumeRepository } from "../src/data/resumeRepository";
import type { EducationItem, Locale } from "../src/model";
import { resumeTables } from "../src/data/resumeRepository";
import type { ResumeRows } from "../src/data/resumeMapper";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const resumeId = "runtime-resume-id";
const row = (fields: Record<string, unknown>) => ({ resume_id: resumeId, ...fields });
function snapshot(withSecondEducation = false) {
  const rows = Object.fromEntries(resumeTables.map(table => [table, []])) as unknown as ResumeRows;
  rows.resume_sites = [{ id: resumeId, site_key: "example-cv", is_published: false, updated_at: null }];
  rows.resume_profile = [row({ graduation_value: "2024", avatar_initials: "XY", photo_url: null, footer_name: "Name", copyright: "© Name" })];
  rows.resume_public_links = [row({ email: "a@example.test", github: "https://example.test", github_label: "GitHub", linkedin_display_name: "Profile", email_label: "Email", linkedin_label: "LinkedIn" })];
  for (const locale of ["zh", "en"] as const) {
    rows.resume_profile_translations.push(row({ locale, name: locale === "zh" ? "姓名" : "Name", nav_about_label: "About", email_action_label: "Email", graduation_label: "Graduation", avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status" }));
    rows.resume_locale_content.push(row({ locale, education_label: "Education", experience_label: "Experience", project_heading: "Projects", skills_label: "Skills", honors_label: "Awards", contact_label: "Contact", availability: "Available", portfolio_label: "CV", portfolio_href: `/${locale}.pdf`, kaggle_label: "Kaggle", updated_at_label: "Updated", linkedin_label: "LinkedIn", linkedin_href: "https://example.test/linkedin" }));
  }
  for (let position = 0; position < 5; position++) {
    const id = `nav-${position}`;
    rows.resume_navigation_items.push(row({ id, position, source_key: null }));
    for (const locale of ["zh", "en"] as const) rows.resume_navigation_item_translations.push(row({ navigation_item_id: id, locale, label: `${locale} nav ${position}` }));
  }
  rows.resume_education_entries = [row({ id: "education-id", source_key: "education-source", position: 0, entry_type: "summerSchool", education_category: "summerSchool" })];
  for (const locale of ["zh", "en"] as const) rows.resume_education_translations.push(row({ education_entry_id: "education-id", locale, title: locale === "zh" ? "中文教育" : "English Education", program: "Program", period: "2024", grade: "A", course_title: null, course_description: locale === "zh" ? "固定描述" : "English course", custom_category_label: null }));
  if (withSecondEducation) {
    rows.resume_education_entries.push(row({ id: "second-id", source_key: "second-source", position: 1, entry_type: "standard", education_category: null }));
    for (const locale of ["zh", "en"] as const) rows.resume_education_translations.push(row({ education_entry_id: "second-id", locale, title: locale === "zh" ? "第二项" : "Second Education", program: "Second Program", period: "2023", grade: "B", course_title: null, course_description: null }));
  }
  return mapResumeRows(rows);
}

function makeRepository(overrides: Partial<ResumeRepository> = {}, withSecondEducation = false) {
  let items = structuredClone(snapshot(withSecondEducation).sections.education);
  const inserted: Record<string, EducationItem["translations"][Locale]> = {};
  const repo: ResumeRepository = {
    load: vi.fn(async () => ({ ...snapshot(), sections: { ...snapshot().sections, education: structuredClone(items) } })),
    updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    updateEducationEntry: vi.fn(async (_resume, id, changes) => {
      items = items.map(item => item.id === id ? { ...item, ...changes } : item);
      const item = items.find(value => value.id === id)!;
      return { resumeId, entryId: id, position: item.position, entryType: item.entryType, category: item.category ?? (item.entryType === "summerSchool" ? "summerSchool" : null), sourceKey: item.sourceKey };
    }),
    updateEducationTranslation: vi.fn(async (_resume, id, locale, translation) => {
      items = items.map(item => item.id === id ? { ...item, translations: { ...item.translations, [locale]: translation } } : item);
      return { resumeId, entryId: id, locale, translation };
    }),
    insertEducationEntry: vi.fn(async (_resume, position, entryType, category) => {
      const parent = { resumeId, entryId: "created-real-id", position, entryType, category: category ?? (entryType === "summerSchool" ? "summerSchool" : null), sourceKey: null };
      items.push({ id: parent.entryId, position, entryType, category: parent.category, sourceKey: null, translations: {
        zh: { title: "", program: "", period: "", grade: "", courseTitle: null, courseDescription: null, customCategoryLabel: null },
        en: { title: "", program: "", period: "", grade: "", courseTitle: null, courseDescription: null, customCategoryLabel: null },
      } });
      return parent;
    }),
    insertEducationTranslation: vi.fn(async (_resume, id, locale, translation) => {
      inserted[`${id}:${locale}`] = translation;
      items = items.map(item => item.id === id ? { ...item, translations: { ...item.translations, [locale]: translation } } : item);
      return { resumeId, entryId: id, locale, translation };
    }),
    readEducationTranslation: vi.fn(async (_resume, id, locale) => inserted[`${id}:${locale}`]
      ? { resumeId, entryId: id, locale, translation: inserted[`${id}:${locale}`] } : null),
    deleteEducationEntry: vi.fn(async (_resume, id) => { items = items.filter(item => item.id !== id); }),
    ...overrides,
  };
  return repo;
}

function openEducation(repository: ResumeRepository, path = "/education", resume = snapshot(), onReloadEducation?: () => Promise<EducationItem[]>, withLocaleProvider = false) {
  const app = <MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}}
    signOutPending={false} signOutError="" resume={resume} repository={repository} onReloadEducation={onReloadEducation ?? null} /></MemoryRouter>;
  return render(withLocaleProvider ? <UiLocaleProvider>{app}</UiLocaleProvider> : app);
}

const categoryOptionLabels = {
  en: { undergraduate: "Undergraduate", graduate: "Graduate", doctoral: "Doctoral", summerSchool: "Summer School", custom: "Custom" },
  zh: { undergraduate: "本科", graduate: "研究生", doctoral: "博士", summerSchool: "暑期学校", custom: "自定义" },
} as const;
function categoryCombobox(index = 1, locale: "zh" | "en" = "en") {
  return screen.getByRole("combobox", { name: `${locale === "zh" ? "教育分类" : "Education category"} ${String(index).padStart(2, "0")}` }) as HTMLButtonElement;
}
function chooseCategory(index: number, category: keyof typeof categoryOptionLabels.en, locale: "zh" | "en" = "en", optionLabel?: string) {
  fireEvent.click(categoryCombobox(index, locale));
  fireEvent.click(screen.getByRole("option", { name: optionLabel ?? categoryOptionLabels[locale][category] }));
}

function adminAuth(): AdminAuthClient {
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin-id", email: "admin@example.test", sessionKey: "session" }),
    isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn().mockReturnValue(() => {}) };
}

afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Stage 4G Education production CRUD", () => {
  it("omits generic save instructions while keeping the route save area", async () => {
    openEducation(makeRepository());
    await screen.findByRole("button", { name: "Save Education changes" });
    const page = document.querySelector(".page-section")!;
    expect(page.querySelector(".production-save-helper")).toBeNull();
    expect(page.querySelector(".save-bar")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Education items" })).toBeNull();
    const addButton = screen.getByRole("button", { name: "Add Education" });
    expect(addButton.closest(".page-heading-title-row")?.querySelector("h1")?.textContent).toBe("Education");
    expect(page.querySelector(".repeatable-group>.group-heading")).toBeNull();
    expect(page.classList.contains("production-save-tail")).toBe(false);
  });

  it("places the category selector after each order number and preserves the title content", async () => {
    openEducation(makeRepository(), "/education", snapshot(true));
    expect(document.querySelectorAll(".education-editor-scope .item-card-heading h3")).toHaveLength(0);
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".education-editor-scope .item-card"));
    expect(cards.map(card => Array.from(card.querySelector(".item-card-heading")!.children[0].children).map(child => child.className))).toEqual([
      ["item-number", "admin-dropdown-control"], ["item-number", "admin-dropdown-control"],
    ]);
    const typeSelect = categoryCombobox();
    expect(typeSelect.textContent).toBe("Summer School");
    fireEvent.click(typeSelect);
    expect(within(screen.getByRole("listbox", { name: "Education category 01" })).getAllByRole("option").map(option => option.textContent))
      .toEqual(["Undergraduate", "Graduate", "Doctoral", "Summer School", "Custom"]);
    expect(categoryCombobox(2).textContent).toBe("Uncategorized");
    fireEvent.click(categoryCombobox(2));
    const legacyListbox = screen.getByRole("listbox", { name: "Education category 02" });
    expect(within(legacyListbox).getByRole("option", { name: "Uncategorized" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(legacyListbox).getByRole("option", { name: "Uncategorized" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByDisplayValue("English Education")).toBeTruthy();
    expect(screen.queryByText("Education type")).toBeNull();
  });

  it.each([
    { category: "undergraduate", zh: "本科教育", en: "Undergraduate Education" },
    { category: "graduate", zh: "研究生教育", en: "Graduate Education" },
    { category: "doctoral", zh: "博士教育", en: "Doctoral Education" },
    { category: "summerSchool", zh: "暑期学校", en: "Summer School" },
  ])("synchronizes default bilingual titles when the user selects $category", ({ category, zh, en }) => {
    openEducation(makeRepository());
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "本科教育" } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Undergraduate Education" } });
    if (category === "summerSchool") chooseCategory(1, "graduate");
    chooseCategory(1, category as keyof typeof categoryOptionLabels.en);
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe(zh);
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe(en);
    expect(categoryCombobox().getAttribute("aria-label")).toBe("Education category 01");
  });

  it("fills blank titles with the selected preset defaults", () => {
    openEducation(makeRepository());
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "" } });
    chooseCategory(1, "doctoral");
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("博士教育");
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Doctoral Education");
  });

  it("preserves customized titles independently while synchronizing preset titles", () => {
    openEducation(makeRepository());
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "金融工程硕士" } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Undergraduate Education" } });
    chooseCategory(1, "graduate");
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("金融工程硕士");
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Graduate Education");

    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "本科教育" } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "MSc Financial Engineering" } });
    chooseCategory(1, "doctoral");
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("博士教育");
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("MSc Financial Engineering");
  });

  it("does not rewrite mismatched titles on initial load and does not synchronize when selecting Custom", () => {
    const loaded = snapshot();
    loaded.sections.education[0] = { ...loaded.sections.education[0], category: "graduate",
      translations: { zh: { ...loaded.sections.education[0].translations.zh, title: "本科教育" },
        en: { ...loaded.sections.education[0].translations.en, title: "Undergraduate Education" } } };
    openEducation(makeRepository(), "/education", loaded);
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("本科教育");
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Undergraduate Education");
    chooseCategory(1, "custom");
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("本科教育");
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Undergraduate Education");
  });

  it("marks synchronized titles dirty, previews them, restores on Cancel, and saves both translations", async () => {
    const repo = makeRepository();
    openEducation(repo);
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "本科教育" } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Undergraduate Education" } });
    chooseCategory(1, "graduate");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(within(screen.getByTestId("resume-preview")).getByRole("heading", { level: 3, name: "Graduate Education" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("中文教育");
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("English Education");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "本科教育" } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Undergraduate Education" } });
    chooseCategory(1, "graduate");
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationTranslation).toHaveBeenCalledWith(resumeId, "education-id", "zh", expect.objectContaining({ title: "研究生教育" }));
    expect(repo.updateEducationTranslation).toHaveBeenCalledWith(resumeId, "education-id", "en", expect.objectContaining({ title: "Graduate Education" }));
  });

  it("localizes the category selector in the Chinese admin UI", async () => {
    window.localStorage.setItem("cms-ui-locale", "en");
    openEducation(makeRepository(), "/education", snapshot(true), undefined, true);
    fireEvent.click(within(screen.getByRole("group", { name: "CMS interface language" })).getByRole("button", { name: "中文" }));
    const categorySelect = categoryCombobox(1, "zh");
    expect(categorySelect.textContent).toBe("暑期学校");
    fireEvent.click(categorySelect);
    expect(within(screen.getByRole("listbox", { name: "教育分类 01" })).getAllByRole("option").map(option => option.textContent))
      .toEqual(["本科", "研究生", "博士", "暑期学校", "自定义"]);
    expect(document.querySelectorAll(".education-editor-scope .item-card-heading h3")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "添加教育经历" })).toBeTruthy();
    window.localStorage.removeItem("cms-ui-locale");
  });

  it("exposes a localized combobox and selects an option through the listbox", () => {
    openEducation(makeRepository());
    const trigger = categoryCombobox();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();
    expect(trigger.textContent).toBe("Summer School");
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "Education category 01" });
    expect(within(listbox).getByRole("option", { name: "Summer School" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(listbox).getByRole("option", { name: "Graduate" }));
    expect(categoryCombobox().textContent).toBe("Graduate");
    expect(document.activeElement).toBe(trigger);
  });

  it("opens with Enter and Space, navigates with arrows, and confirms with Enter", () => {
    openEducation(makeRepository());
    const trigger = categoryCombobox();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("listbox", { name: "Education category 01" })).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.keyDown(trigger, { key: " " });
    expect(screen.getByRole("listbox", { name: "Education category 01" })).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Custom" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: " " });
    expect(categoryCombobox().textContent).toBe("Custom");
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Summer School" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Doctoral" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(categoryCombobox().textContent).toBe("Doctoral");
  });

  it("Escape closes without changing the category, and outside pointer closes the popup", () => {
    openEducation(makeRepository());
    const trigger = categoryCombobox();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Custom" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(categoryCombobox().textContent).toBe("Summer School");
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "Education category 01" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(categoryCombobox().textContent).toBe("Summer School");

    fireEvent.click(trigger);
    expect(fireEvent.keyDown(trigger, { key: "Tab" })).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)?.hidden).toBe(true);
  });

  it("supports Home and End to move the active option to the first and last categories", () => {
    openEducation(makeRepository());
    const trigger = categoryCombobox();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "End" });
    expect(screen.getByRole("option", { name: "Custom" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(screen.getByRole("option", { name: "Undergraduate" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(categoryCombobox().textContent).toBe("Summer School");
  });

  it("does not open the category dropdown while Education is saving", async () => {
    let finishUpdate!: () => void;
    const updateEducationEntry = vi.fn(async (_resume: string, entryId: string) => {
      await new Promise<void>(resolve => { finishUpdate = resolve; });
      return { resumeId, entryId, position: 0, entryType: "standard" as const, category: "graduate" as const, sourceKey: "education-source" };
    });
    const repo = makeRepository({ updateEducationEntry });
    openEducation(repo);
    chooseCategory(1, "graduate");
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await waitFor(() => expect(categoryCombobox().disabled).toBe(true));
    fireEvent.click(categoryCombobox());
    fireEvent.keyDown(categoryCombobox(), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
    finishUpdate();
    await screen.findByText("Education changes saved to production.");
  });

  it("marks a category edit dirty, Cancel restores it, and Save persists classification without changing titles", async () => {
    const repo = makeRepository(); openEducation(repo);
    expect(categoryCombobox().textContent).toBe("Summer School");
    chooseCategory(1, "graduate");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByDisplayValue("中文教育")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(categoryCombobox().textContent).toBe("Summer School");
    expect(screen.getByDisplayValue("中文教育")).toBeTruthy();
    expect(repo.updateEducationEntry).not.toHaveBeenCalled();

    chooseCategory(1, "graduate");
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "education-id", { entryType: "standard", category: "graduate" });
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("中文教育")).toBeTruthy();
    expect(categoryCombobox().textContent).toBe("Graduate");
  });

  it("persists custom category labels bilingually without replacing resume titles", async () => {
    window.localStorage.setItem("cms-ui-locale", "en");
    const repo = makeRepository(); openEducation(repo, "/education", snapshot(), undefined, true);
    chooseCategory(1, "custom");
    fireEvent.change(screen.getByLabelText("Chinese Custom category name"), { target: { value: "交换学习" } });
    fireEvent.change(screen.getByLabelText("English Custom category name"), { target: { value: "Exchange Program" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "education-id", { entryType: "standard", category: "custom" });
    expect(repo.updateEducationTranslation).toHaveBeenCalledTimes(2);
    expect(repo.updateEducationTranslation).toHaveBeenCalledWith(resumeId, "education-id", "zh", expect.objectContaining({ customCategoryLabel: "交换学习", title: "中文教育" }));
    expect(repo.updateEducationTranslation).toHaveBeenCalledWith(resumeId, "education-id", "en", expect.objectContaining({ customCategoryLabel: "Exchange Program", title: "English Education" }));
    expect(categoryCombobox().textContent).toBe("Exchange Program");
    expect(screen.getByDisplayValue("中文教育")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "CMS interface language" })).getByRole("button", { name: "中文" }));
    expect(categoryCombobox(1, "zh").textContent).toBe("交换学习");
    window.localStorage.removeItem("cms-ui-locale");
  });

  it("keeps category identity and independent expansion when entries are reordered", async () => {
    const repo = makeRepository({}, true); openEducation(repo, "/education", snapshot(true));
    chooseCategory(2, "doctoral");
    fireEvent.click(screen.getByRole("button", { name: "Edit Doctoral" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Doctoral up" }));
    expect(document.querySelectorAll(".education-editor-scope .item-card-body")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "second-id", { entryType: "standard", category: "doctoral" });
    expect(categoryCombobox(1).textContent).toBe("Doctoral");
    expect(categoryCombobox(2).textContent).toBe("Summer School");
    expect(document.querySelectorAll(".education-editor-scope .item-card-body")).toHaveLength(2);
  });

  it("keeps Education entries independently expanded by UUID through reorder, add, and delete", async () => {
    const repo = makeRepository({}, true);
    openEducation(repo, "/education", snapshot(true));
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".education-editor-scope .item-card"));
    expect(cards[0].querySelector(".item-card-body")).toBeTruthy();
    expect(cards[1].querySelector(".item-card-body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit Uncategorized" }));
    expect(document.querySelectorAll(".education-editor-scope .item-card-body")).toHaveLength(2);
    const stableFieldIds = cards.map(card => card.querySelector<HTMLInputElement>("input")!.id);
    fireEvent.click(screen.getByRole("button", { name: "Move Uncategorized up" }));
    expect(document.querySelectorAll(".education-editor-scope .item-card-body")).toHaveLength(2);
    for (const id of stableFieldIds) expect(document.getElementById(id)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add Education" }));
    expect(document.querySelectorAll(".education-editor-scope .item-card-body")).toHaveLength(3);
    const secondEntry = Array.from(document.querySelectorAll<HTMLElement>(".education-editor-scope .item-card"))
      .find(card => card.querySelector<HTMLInputElement>('input[id^="second-id-"]'))!;
    fireEvent.click(secondEntry.querySelector<HTMLButtonElement>(".danger-text")!);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Education entry deleted from production.");
    expect(document.querySelectorAll(".education-editor-scope .item-card-body")).toHaveLength(2);
  });

  it("updates a shared entry field against its real UUID and retains that UUID", async () => {
    const repo = makeRepository(); openEducation(repo);
    chooseCategory(1, "undergraduate");
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "education-id", { entryType: "standard", category: "undergraduate" });
    expect(repo.deleteEducationEntry).not.toHaveBeenCalled();
  });

  it("updates zh and en translation rows independently and preserves the existing UUID", async () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "中文已改" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationTranslation).toHaveBeenCalledOnce();
    expect(repo.updateEducationTranslation).toHaveBeenCalledWith(resumeId, "education-id", "zh", expect.objectContaining({ title: "中文已改" }));
    expect(repo.updateEducationTranslation).not.toHaveBeenCalledWith(resumeId, "education-id", "en", expect.anything());
    expect(repo.deleteEducationEntry).not.toHaveBeenCalled();
  });

  it("edits and saves Chinese summer-school descriptions through the normal bilingual flow", async () => {
    const repo = makeRepository();
    openEducation(repo);
    const field = screen.getByLabelText("Chinese Course description") as HTMLTextAreaElement;
    expect(field.readOnly).toBe(false);
    expect(field.value).toBe("固定描述");
    expect((screen.getByLabelText("English Course description") as HTMLTextAreaElement).readOnly).toBe(false);
    expect(screen.queryByText("Not editable in the first CMS release. The public renderer uses fixed phrase styling here.")).toBeNull();

    const updated = "这是一个完全由内容管理系统控制的课程描述。";
    fireEvent.change(field, { target: { value: updated } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");

    expect(repo.updateEducationTranslation).toHaveBeenCalledWith(resumeId, "education-id", "zh", expect.objectContaining({ courseDescription: updated }));
    expect(repo.updateEducationTranslation).not.toHaveBeenCalledWith(resumeId, "education-id", "en", expect.anything());
    expect((screen.getByLabelText("Chinese Course description") as HTMLTextAreaElement).value).toBe(updated);
  });

  it("creates one parent and two independent translations, then adopts the returned UUID", async () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.click(screen.getByRole("button", { name: "Add Education" }));
    fireEvent.change(screen.getAllByLabelText("Chinese Title").at(-1)!, { target: { value: "新增中文" } });
    fireEvent.change(screen.getAllByLabelText("English Title").at(-1)!, { target: { value: "New English" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.insertEducationEntry).toHaveBeenCalledOnce();
    expect(repo.insertEducationTranslation).toHaveBeenCalledTimes(2);
    expect(repo.insertEducationTranslation).toHaveBeenCalledWith(resumeId, "created-real-id", "zh", expect.objectContaining({ title: "新增中文" }));
    expect(repo.insertEducationTranslation).toHaveBeenCalledWith(resumeId, "created-real-id", "en", expect.objectContaining({ title: "New English" }));
    expect(screen.getByDisplayValue("新增中文").id).toContain("created-real-id");
    expect(document.getElementById("created-real-id-zh-title")?.closest(".item-card")?.querySelector(".item-card-body")).toBeTruthy();
    expect(document.getElementById("education-id-zh-title")?.closest(".item-card")?.querySelector(".item-card-body")).toBeTruthy();
  });

  it("keeps a partial create visibly incomplete and resumes only the missing locale", async () => {
    const repo = makeRepository();
    const insertTranslation = vi.mocked(repo.insertEducationTranslation!).getMockImplementation()!;
    let failEnglishOnce = true;
    vi.mocked(repo.insertEducationTranslation!).mockImplementation(async (_resume, id, locale, translation) => {
      if (locale === "en" && failEnglishOnce) { failEnglishOnce = false; throw new Error("English insert failed"); }
      return insertTranslation(resumeId, id, locale, translation);
    });
    openEducation(repo);
    fireEvent.click(screen.getByRole("button", { name: "Add Education" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText(/Production created the parent/);
    expect(repo.insertEducationEntry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.insertEducationEntry).toHaveBeenCalledOnce();
    expect(repo.insertEducationTranslation).toHaveBeenCalledTimes(3);
    expect(vi.mocked(repo.insertEducationTranslation!).mock.calls.map(call => call[2])).toEqual(["zh", "en", "en"]);
    expect(repo.insertEducationTranslation).toHaveBeenLastCalledWith(resumeId, "created-real-id", "en", expect.anything());
  });

  it("requires explicit delete confirmation and removes only after confirmed success", async () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(repo.deleteEducationEntry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Education entry deleted from production.");
    expect(repo.deleteEducationEntry).toHaveBeenCalledWith(resumeId, "education-id");
    expect(screen.queryByDisplayValue("English Education")).toBeNull();
  });

  it("retains a failed deletion and allows retry", async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error("delete denied")).mockResolvedValue(undefined);
    const repo = makeRepository({ deleteEducationEntry: remove }); openEducation(repo);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("delete denied");
    expect(screen.getByDisplayValue("English Education")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Education entry deleted from production.");
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("reorders with real UUIDs and leaves source keys untouched", async () => {
    const repo = makeRepository({}, true);
    openEducation(repo, "/education", snapshot(true));
    fireEvent.click(screen.getByRole("button", { name: "Move Uncategorized up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "second-id", { position: expect.any(Number) });
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "second-id", { position: 0 });
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "education-id", { position: 1 });
    expect(repo.updateEducationEntry).not.toHaveBeenCalledWith(resumeId, "education-id", expect.objectContaining({ sourceKey: expect.anything() }));
  });

  it("surfaces partial reorder failure and refreshes only Education from authoritative production", async () => {
    const load = vi.fn(async () => snapshot());
    const loadEducation = vi.fn(async () => snapshot(true).sections.education);
    const update = vi.fn(async (_resume: string, _id: string, changes: Partial<Pick<EducationItem, "position" | "entryType" | "category">>) => {
      if (changes.position === 1) throw new Error("position update failed");
      return { resumeId, entryId: "education-id", position: changes.position ?? 0, entryType: "summerSchool" as const, category: "summerSchool" as const, sourceKey: "education-source" };
    });
    const repo = makeRepository({ load, updateEducationEntry: update }, true);
    openEducation(repo, "/education", snapshot(true), loadEducation);
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "Unsaved field survives recovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Uncategorized up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText(/partially applied; the displayed order was refreshed/);
    expect(loadEducation).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("Unsaved field survives recovery");
    expect(screen.getByRole("alert").textContent).toContain("position update failed");
  });

  it("keeps unsaved drafts across Education → Profile → Education and Cancel restores confirmed values", async () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "Unsaved 中文" } });
    fireEvent.click(screen.getByRole("link", { name: "Profile" }));
    await screen.findByRole("heading", { name: "Profile" });
    fireEvent.click(screen.getByRole("link", { name: "Education" }));
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("Unsaved 中文");
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Chinese Title") as HTMLInputElement).value).toBe("中文教育");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.queryByText(/last confirmed production values|changes reverted|上次确认的生产数据|已恢复/i)).toBeNull();
  });

  it.each([
    { locale: "en" as const, cancel: "Cancel changes", clean: "No unsaved changes" },
    { locale: "zh" as const, cancel: "取消修改", clean: "没有未保存修改" },
  ])("Education Cancel clears the normal success notice in $locale UI", async ({ locale, cancel, clean }) => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    openEducation(makeRepository(), "/education", snapshot(), undefined, true);
    const field = await screen.findByDisplayValue("中文教育") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "未保存的教育修改" } });
    expect(screen.getByText(locale === "zh" ? "有未保存修改" : "Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: cancel }));

    expect(field.value).toBe("中文教育");
    expect(screen.getByText(clean)).toBeTruthy();
    expect(screen.queryByText(/last confirmed production values|changes reverted|上次确认的生产数据|已恢复/i)).toBeNull();
  });

  it("discards an unsaved new local draft without issuing DELETE", () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.click(screen.getByRole("button", { name: "Add Education" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(repo.deleteEducationEntry).not.toHaveBeenCalled();
    expect(repo.insertEducationEntry).not.toHaveBeenCalled();
  });

  it("retains the standard and summerSchool type distinction", async () => {
    const repo = makeRepository(); openEducation(repo);
    expect(categoryCombobox().textContent).toBe("Summer School");
    chooseCategory(1, "undergraduate");
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "education-id", { entryType: "standard", category: "undergraduate" });
    expect(screen.queryByLabelText("Chinese Course description")).toBeNull();
  });

  it("does not autosave on navigation or persist drafts in browser storage", async () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Navigation draft" } });
    fireEvent.click(screen.getByRole("link", { name: "Profile" }));
    await screen.findByRole("heading", { name: "Profile" });
    expect(repo.updateEducationEntry).not.toHaveBeenCalled();
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
    expect(repo.insertEducationEntry).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    const sessionKeys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index) ?? "");
    expect(sessionKeys.every(key => key.startsWith("example-cv-cms:ui:"))).toBe(true);
    expect(Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index) ?? "")))
      .not.toContain("Navigation draft");
  });

  it("discards Education drafts after an application remount", () => {
    const repo = makeRepository();
    const first = openEducation(repo);
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Remount-only draft" } });
    first.unmount();
    openEducation(repo);
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("English Education");
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });

  it("discards in-memory Education drafts on sign-out", async () => {
    const repo = makeRepository();
    const client = adminAuth();
    render(<MemoryRouter initialEntries={["/education"]}><AuthGate client={client} resumeRepository={repo} /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("English Title"), { target: { value: "Sign-out-only draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("heading", { name: "Welcome back" });
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });
});
