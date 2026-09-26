import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { mapResumeRows } from "../src/data/resumeMapper";
import type { ResumeRepository } from "../src/data/resumeRepository";
import type { EducationItem, Locale } from "../src/model";
import { resumeTables } from "../src/data/resumeRepository";
import type { ResumeRows } from "../src/data/resumeMapper";

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
  rows.resume_education_entries = [row({ id: "education-id", source_key: "education-source", position: 0, entry_type: "summerSchool" })];
  for (const locale of ["zh", "en"] as const) rows.resume_education_translations.push(row({ education_entry_id: "education-id", locale, title: locale === "zh" ? "中文教育" : "English Education", program: "Program", period: "2024", grade: "A", course_title: null, course_description: locale === "zh" ? "固定描述" : "English course" }));
  if (withSecondEducation) {
    rows.resume_education_entries.push(row({ id: "second-id", source_key: "second-source", position: 1, entry_type: "standard" }));
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
      return { resumeId, entryId: id, position: item.position, entryType: item.entryType, sourceKey: item.sourceKey };
    }),
    updateEducationTranslation: vi.fn(async (_resume, id, locale, translation) => {
      items = items.map(item => item.id === id ? { ...item, translations: { ...item.translations, [locale]: translation } } : item);
      return { resumeId, entryId: id, locale, translation };
    }),
    insertEducationEntry: vi.fn(async (_resume, position, entryType) => {
      const parent = { resumeId, entryId: "created-real-id", position, entryType, sourceKey: null };
      items.push({ id: parent.entryId, position, entryType, sourceKey: null, translations: {
        zh: { title: "", program: "", period: "", grade: "", courseTitle: null, courseDescription: null },
        en: { title: "", program: "", period: "", grade: "", courseTitle: null, courseDescription: null },
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

function openEducation(repository: ResumeRepository, path = "/education", resume = snapshot(), onReloadEducation?: () => Promise<EducationItem[]>) {
  return render(<MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}}
    signOutPending={false} signOutError="" resume={resume} repository={repository} onReloadEducation={onReloadEducation ?? null} /></MemoryRouter>);
}

function adminAuth(): AdminAuthClient {
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin-id", email: "admin@example.test", sessionKey: "session" }),
    isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn().mockReturnValue(() => {}) };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Stage 4G Education production CRUD", () => {
  it("renders the helper before the sticky production save bar without the tail-padding workaround", async () => {
    openEducation(makeRepository());
    await screen.findByRole("button", { name: "Save Education changes" });
    const page = document.querySelector(".page-section")!;
    const helper = page.querySelector(".production-save-helper")!;
    const saveBar = page.querySelector(".save-bar")!;
    expect(Array.from(page.children).indexOf(helper)).toBeLessThan(Array.from(page.children).indexOf(saveBar));
    expect(page.classList.contains("production-save-tail")).toBe(false);
  });

  it("updates a shared entry field against its real UUID and retains that UUID", async () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.change(screen.getByLabelText("Entry type (shared)"), { target: { value: "standard" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "education-id", { entryType: "standard" });
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

  it("preserves the Chinese summer-school description as read-only", () => {
    openEducation(makeRepository());
    const field = screen.getByLabelText("Chinese Course description") as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe("固定描述");
    expect(screen.getByLabelText("English Course description").getAttribute("readonly")).toBeNull();
  });

  it("creates one parent and two independent translations, then adopts the returned UUID", async () => {
    const repo = makeRepository(); openEducation(repo);
    fireEvent.click(screen.getByRole("button", { name: "Add Education" }));
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "新增中文" } });
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "New English" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.insertEducationEntry).toHaveBeenCalledOnce();
    expect(repo.insertEducationTranslation).toHaveBeenCalledTimes(2);
    expect(repo.insertEducationTranslation).toHaveBeenCalledWith(resumeId, "created-real-id", "zh", expect.objectContaining({ title: "新增中文" }));
    expect(repo.insertEducationTranslation).toHaveBeenCalledWith(resumeId, "created-real-id", "en", expect.objectContaining({ title: "New English" }));
    expect(screen.getByDisplayValue("新增中文").id).toContain("created-real-id");
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
    fireEvent.click(screen.getByRole("button", { name: "Move Second Education up" }));
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
    const update = vi.fn(async (_resume: string, _id: string, changes: Partial<Pick<EducationItem, "position" | "entryType">>) => {
      if (changes.position === 1) throw new Error("position update failed");
      return { resumeId, entryId: "education-id", position: changes.position ?? 0, entryType: "summerSchool" as const, sourceKey: "education-source" };
    });
    const repo = makeRepository({ load, updateEducationEntry: update }, true);
    openEducation(repo, "/education", snapshot(true), loadEducation);
    fireEvent.change(screen.getByLabelText("Chinese Title"), { target: { value: "Unsaved field survives recovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Second Education up" }));
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
    expect((screen.getByLabelText("Entry type (shared)") as HTMLSelectElement).value).toBe("summerSchool");
    fireEvent.change(screen.getByLabelText("Entry type (shared)"), { target: { value: "standard" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    await screen.findByText("Education changes saved to production.");
    expect(repo.updateEducationEntry).toHaveBeenCalledWith(resumeId, "education-id", { entryType: "standard" });
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
    await screen.findByRole("heading", { name: "Sign in" });
    expect(repo.updateEducationTranslation).not.toHaveBeenCalled();
  });
});
