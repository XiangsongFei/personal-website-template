import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { App } from "../src/App";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { mapResumeRows, type ResumeRows } from "../src/data/resumeMapper";
import { createResumeRepository, resumeTables, type ResumeRepository, type ResumeSectionRepository } from "../src/data/resumeRepository";

const resumeId = "runtime-resume-id";
const r = (fields: Record<string, unknown>) => ({ resume_id: resumeId, ...fields });

function databaseRows(): ResumeRows {
  const rows = Object.fromEntries(resumeTables.map(table => [table, []])) as unknown as ResumeRows;
  rows.resume_sites = [{ id: resumeId, site_key: "example-cv", is_published: false, updated_at: "2026-01-01T00:00:00Z" }];
  rows.resume_profile = [r({ graduation_value: "2024", avatar_initials: "XY", footer_name: "Actual Name", copyright: "© Actual Name" })];
  rows.resume_public_links = [r({ email: "real@example.test", github: "https://example.test/git", github_label: "GitHub", linkedin_display_name: "Real profile", email_label: "Email", linkedin_label: "LinkedIn" })];
  for (const locale of ["zh", "en"] as const) {
    rows.resume_profile_translations.push(r({ locale, name: locale === "zh" ? "真实姓名" : "Actual Name", nav_about_label: "About", email_action_label: "Email", graduation_label: "Graduation", avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status" }));
    rows.resume_locale_content.push(r({ locale, education_label: "Education", experience_label: "Experience", project_heading: "Projects", skills_label: "Skills", honors_label: "Awards", contact_label: "Contact", availability: locale === "zh" ? "中文状态" : "English status", portfolio_label: "CV", portfolio_href: locale === "zh" ? "/zh.pdf" : "/en.pdf", kaggle_label: "Kaggle", updated_at_label: "Updated", linkedin_label: "LinkedIn", linkedin_href: "https://example.test/linkedin" }));
  }
  rows.resume_intro_paragraphs = [r({ id: "intro-b", position: 1, source_key: null }), r({ id: "intro-a", position: 0, source_key: null })];
  for (const parent of rows.resume_intro_paragraphs) for (const locale of ["zh", "en"]) rows.resume_intro_paragraph_translations.push(r({ paragraph_id: parent.id, locale, text: `${locale}-${parent.id}\nsecond line` }));
  for (let position = 0; position < 5; position++) {
    const id = `nav-${position}`;
    rows.resume_navigation_items.push(r({ id, position, source_key: null }));
    for (const locale of ["zh", "en"]) rows.resume_navigation_item_translations.push(r({ navigation_item_id: id, locale, label: `${locale}-${id}` }));
  }
  rows.resume_education_entries = [r({ id: "education-id", source_key: null, position: 0, entry_type: "summerSchool" })];
  for (const locale of ["zh", "en"]) rows.resume_education_translations.push(r({ education_entry_id: "education-id", locale, title: locale === "zh" ? "真实教育" : "Actual Education", program: "Program", period: "2024", grade: "A", course_title: null, course_description: null }));
  rows.resume_experience_entries = [r({ id: "experience-id", source_key: "experience-key", position: 0 })];
  for (const locale of ["zh", "en"]) rows.resume_experience_translations.push(r({ experience_entry_id: "experience-id", locale, organization: "Organization", title: "Role", period: "2025", description: "Line 1\nLine 2", location: null }));
  rows.resume_project_entries = [r({ id: "project-id", source_key: "project-key", position: 0 })];
  for (const locale of ["zh", "en"]) rows.resume_project_translations.push(r({ project_entry_id: "project-id", locale, title: "Project", subtitle: "Subtitle", period: "2025", description: "Description", href: "https://example.test/project" }));
  rows.resume_project_methods = [r({ id: "method-b", project_entry_id: "project-id", locale: "en", position: 1, value: "Second" }), r({ id: "method-a", project_entry_id: "project-id", locale: "en", position: 0, value: "First" })];
  rows.resume_skill_groups = [r({ id: "skill-id", source_key: "skill-key", position: 0 })];
  for (const locale of ["zh", "en"]) rows.resume_skill_group_translations.push(r({ skill_group_id: "skill-id", locale, title: "Skill", items: "One · Two" }));
  rows.resume_contact_focus_items = [r({ id: "focus-id", position: 0 })];
  for (const locale of ["zh", "en"]) rows.resume_contact_focus_translations.push(r({ focus_item_id: "focus-id", locale, title: "Focus", detail: "Detail" }));
  rows.resume_contact_status_items = [r({ id: "status-id", position: 0, status_type: "open" })];
  for (const locale of ["zh", "en"]) rows.resume_contact_status_translations.push(r({ status_item_id: "status-id", locale, title: "Status", detail: "Detail" }));
  return rows;
}

function mockSupabase(rows: ResumeRows, failTable?: string) {
  const calls: { table: string; column: string; value: string; selected: string }[] = [];
  const mutation = vi.fn(() => { throw new Error("A production mutation was attempted"); });
  const from = vi.fn((table: string) => ({
    select: (selected: string) => ({
      eq: (column: string, value: string) => {
        calls.push({ table, column, value, selected });
        const result = table === "resume_sites" ? rows.resume_sites[0] : rows[table as keyof ResumeRows];
        const response = { data: failTable === table ? null : result, error: failTable === table ? { message: "query failed" } : null };
        return table === "resume_sites" ? { maybeSingle: async () => response } : Promise.resolve(response);
      },
    }),
    insert: mutation, update: mutation, upsert: mutation, delete: mutation,
  }));
  return { client: { from } as unknown as SupabaseClient, calls, mutation };
}

function auth(identity: boolean, allowed = true): AdminAuthClient {
  return {
    getIdentity: vi.fn().mockResolvedValue(identity ? { id: "admin-id", email: "admin@example.test", sessionKey: "admin-session" } : null),
    isResumeAdmin: vi.fn().mockResolvedValue(allowed), signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Stage 4D normalized read and mapping", () => {
  it("loads site metadata and each section only from its declared tables", async () => {
    const sectionCases = [
      ["loadOverview", ["resume_profile_translations"]],
      ["loadProfile", ["resume_profile", "resume_profile_translations"]],
      ["loadIntroduction", ["resume_intro_paragraphs", "resume_intro_paragraph_translations"]],
      ["loadEducation", ["resume_education_entries", "resume_education_translations"]],
      ["loadExperience", ["resume_experience_entries", "resume_experience_translations"]],
      ["loadProjects", ["resume_project_entries", "resume_project_translations", "resume_project_methods"]],
      ["loadSkills", ["resume_skill_groups", "resume_skill_group_translations"]],
      ["loadAwards", ["resume_award_entries", "resume_award_translations"]],
      ["loadContact", ["resume_locale_content", "resume_contact_focus_items", "resume_contact_focus_translations", "resume_contact_status_items", "resume_contact_status_translations"]],
      ["loadLinks", ["resume_public_links", "resume_locale_content", "resume_navigation_items", "resume_navigation_item_translations"]],
    ] as const;
    const metadataDb = mockSupabase(databaseRows());
    const metadata = await createResumeRepository(metadataDb.client).loadSiteMetadata();
    expect(metadata).toEqual({ resumeId, siteKey: "example-cv", isPublished: false, updatedAt: "2026-01-01T00:00:00Z" });
    expect(metadataDb.calls.map(call => call.table)).toEqual(["resume_sites"]);

    for (const [method, expectedTables] of sectionCases) {
      const db = mockSupabase(databaseRows());
      const repository = createResumeRepository(db.client);
      await repository[method](resumeId);
      expect(db.calls.map(call => call.table), method).toEqual(expectedTables);
      expect(db.calls.every(call => call.column === "resume_id" && call.value === resumeId && call.selected === "*")).toBe(true);
      expect(db.mutation).not.toHaveBeenCalled();
    }
  });

  it("maps overview from the English profile translation without reading the full resume", async () => {
    const db = mockSupabase(databaseRows());
    const overview = await createResumeRepository(db.client).loadOverview(resumeId);
    expect(overview).toEqual({ profileName: "Actual Name" });
    expect(db.calls.map(call => call.table)).toEqual(["resume_profile_translations"]);
  });

  it("rejects section rows owned by another resume and preserves locale separation", async () => {
    const rows = databaseRows();
    rows.resume_education_entries[0].resume_id = "another-resume";
    await expect(createResumeRepository(mockSupabase(rows).client).loadEducation(resumeId)).rejects.toThrow("another resume");

    const missingEnglish = databaseRows();
    missingEnglish.resume_education_translations = missingEnglish.resume_education_translations.filter(row => row.locale === "zh");
    const education = await createResumeRepository(mockSupabase(missingEnglish).client).loadEducation(resumeId);
    expect(education[0].translations.zh.title).toBe("真实教育");
    expect(education[0].translations.en.title).toBe("");
    expect(education[0].translations.en.courseTitle).toBeNull();
  });

  it("preserves UUIDs, nullable source keys, multiline text, and deterministic position ties in section parsers", async () => {
    const rows = databaseRows();
    const uuid = "a4b55180-98d2-4f2a-9a7e-01c831a3c157";
    rows.resume_education_entries = [r({ id: uuid, source_key: null, position: 0, entry_type: "summerSchool" }), r({ id: "education-earlier", source_key: "stable-key", position: 0, entry_type: "standard" })];
    rows.resume_education_translations = [
      r({ education_entry_id: uuid, locale: "zh", title: "标题\n第二行", program: "", period: "2024", grade: "", course_title: null, course_description: "" }),
      r({ education_entry_id: uuid, locale: "en", title: "UUID item", program: "", period: "2024", grade: "", course_title: null, course_description: "" }),
    ];
    const education = await createResumeRepository(mockSupabase(rows).client).loadEducation(resumeId);
    expect(education.map(entry => entry.id)).toEqual([uuid, "education-earlier"]);
    expect(education[0]).toMatchObject({ sourceKey: null, entryType: "summerSchool", translations: { zh: { title: "标题\n第二行", program: "", courseTitle: null, courseDescription: "" } } });
  });

  it("resolves exactly the target site, then reads every normalized table by returned resume ID", async () => {
    const db = mockSupabase(databaseRows());
    const loaded = await createResumeRepository(db.client).load();
    expect(loaded.resumeId).toBe(resumeId);
    expect(loaded.isPublished).toBe(false);
    expect(db.calls[0]).toEqual({ table: "resume_sites", column: "site_key", value: "example-cv", selected: "*" });
    expect(db.calls.slice(1).map(call => call.table)).toEqual(resumeTables);
    expect(db.calls.slice(1).every(call => call.column === "resume_id" && call.value === resumeId && call.selected === "*")).toBe(true);
    expect(db.mutation).not.toHaveBeenCalled();
  });

  it("maps both locales, actual keys, ordering, IDs, methods.value, and nullable fields", () => {
    const loaded = mapResumeRows(databaseRows());
    const s = loaded.sections;
    expect(s.profile.translations.zh.name).toBe("真实姓名");
    expect(s.profile.translations.en.name).toBe("Actual Name");
    expect(s.introduction.map(item => item.id)).toEqual(["intro-a", "intro-b"]);
    expect(s.introduction[0].translations.zh.text).toBe("zh-intro-a\nsecond line");
    expect(s.links.navigation.map(item => item.sectionId)).toEqual(["experience", "projects", "skills", "awards", "contact"]);
    expect(s.links.navigation[0].translations.en.label).toBe("en-nav-0");
    expect(s.education[0]).toMatchObject({ id: "education-id", sourceKey: null, entryType: "summerSchool" });
    expect(s.education[0].translations.en.courseTitle).toBeNull();
    expect(s.experience[0].translations.en.location).toBeNull();
    expect(s.experience[0].translations.en.description).toBe("Line 1\nLine 2");
    expect(s.projects[0].methods.en.map(method => [method.id, method.value])).toEqual([["method-a", "First"], ["method-b", "Second"]]);
    expect(s.contact.focus[0].translations.zh.title).toBe("Focus");
    expect(s.contact.status[0]).toMatchObject({ id: "status-id", statusType: "open" });
    expect(s.contact.translations.zh.availability).toBe("中文状态");
    expect(s.links.translations.en).toMatchObject({ portfolioHref: "/en.pdf", linkedInHref: "https://example.test/linkedin" });
    expect(s.links.shared.email).toBe("real@example.test");
    expect(s.skills[0]).toMatchObject({ id: "skill-id", sourceKey: "skill-key", translations: { zh: { title: "Skill", items: "One · Two" } } });
    expect(s.profile.shared.footerName).toBe("Actual Name");
    expect(s.awards).toEqual([]);
  });

  it("maps awards and uses ID as a deterministic tie breaker for equal positions", () => {
    const rows = databaseRows();
    rows.resume_award_entries = [r({ id: "award-id", source_key: null, position: 0 })];
    rows.resume_award_translations = [r({ award_entry_id: "award-id", locale: "zh", name: "荣誉", year: "2025" }), r({ award_entry_id: "award-id", locale: "en", name: "Award", year: "2025" })];
    rows.resume_intro_paragraphs[0].position = 0;
    const sections = mapResumeRows(rows).sections;
    expect(sections.awards[0]).toMatchObject({ id: "award-id", sourceKey: null, translations: { zh: { name: "荣誉", year: "2025" }, en: { name: "Award", year: "2025" } } });
    expect(sections.introduction.map(entry => entry.id)).toEqual(["intro-a", "intro-b"]);
  });

  it("leaves a genuinely missing translation empty instead of borrowing the other locale", () => {
    const rows = databaseRows();
    rows.resume_education_translations = rows.resume_education_translations.filter(row => row.locale === "zh");
    const entry = mapResumeRows(rows).sections.education[0];
    expect(entry.translations.zh.title).toBe("真实教育");
    expect(entry.translations.en.title).toBe("");
    expect(entry.translations.en.courseTitle).toBeNull();
  });

  it("fails on missing site or a required child-query error without returning fixtures", async () => {
    const missing = databaseRows(); missing.resume_sites = [];
    await expect(createResumeRepository(mockSupabase(missing).client).load()).rejects.toThrow("Target resume site not found");
    await expect(createResumeRepository(mockSupabase(databaseRows(), "resume_award_entries").client).load()).rejects.toThrow("Unable to load resume_award_entries");
  });

  it("exposes scoped reads and explicitly allowlisted production mutation paths", () => {
    const repository = createResumeRepository(mockSupabase(databaseRows()).client);
    expect(Object.keys(repository)).toEqual(["updateEditableEntryPosition", "insertEditableEntry", "updateEditableTranslation", "insertEditableTranslation", "readEditableTranslation", "deleteEditableTranslation", "deleteEditableEntry", "uploadResumePdf", "updateProjectPosition", "insertProject", "updateProjectTranslation", "insertProjectTranslation", "readProjectTranslation", "deleteProjectTranslation", "deleteProject", "updateProjectMethod", "insertProjectMethod", "readProjectMethodByPosition", "deleteProjectMethod", "updateFocusPosition", "insertFocus", "updateFocusTranslation", "insertFocusTranslation", "readFocusTranslation", "deleteFocusTranslation", "deleteFocus", "updateStatusPosition", "updateStatusType", "insertStatus", "updateStatusTranslation", "insertStatusTranslation", "readStatusTranslation", "deleteStatusTranslation", "deleteStatus", "updateContactAvailability", "updateContactLabel", "updatePublicLinks", "updateSiteText", "updateNavigationLabel", "load", "loadSiteMetadata", "loadOverview", "loadProfile", "loadIntroduction", "loadEducation", "loadExperience", "loadProjects", "loadSkills", "loadAwards", "loadContact", "loadLinks", "updateProfileSharedDetails", "updateProfileTranslation", "updateEducationEntry", "updateEducationTranslation", "insertEducationEntry", "insertEducationTranslation", "readEducationTranslation", "deleteEducationEntry"]);
    const source = readFileSync(resolve("src/data/resumeRepository.ts"), "utf8");
    expect(source).not.toMatch(/\.upsert\s*\(/);
    expect(source.match(/\.update\s*\(/g)).toHaveLength(6);
    expect(source.match(/\.insert\s*\(/g)).toHaveLength(4);
    expect(source.match(/\.delete\s*\(/g)).toHaveLength(4);
    expect(source).toContain('.from("resume_profile")');
    expect(source).toContain('.from("resume_profile_translations")');
    expect(source).toContain('.from("resume_education_entries")');
    expect(source).toContain('.from("resume_education_translations")');
    expect(source).not.toContain("cms_admins");
    expect(source).not.toContain("service_role");
  });
});

describe("Stage 4D auth-gated editor", () => {
  it("does not load production content before authorization, including signed out and denied routes", async () => {
    const repository: ResumeRepository = { load: vi.fn(), updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn() };
    const signedOut = render(<MemoryRouter initialEntries={["/education"]}><AuthGate client={auth(false)} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(repository.load).not.toHaveBeenCalled();
    signedOut.unmount();
    render(<MemoryRouter initialEntries={["/education"]}><AuthGate client={auth(true, false)} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Access denied" });
    expect(repository.load).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Education" })).toBeNull();
  });

  it("shows loading rather than fixtures, then the mapped production editor", async () => {
    let resolve!: (value: ReturnType<typeof mapResumeRows>) => void;
    const repository: ResumeRepository = { load: vi.fn().mockReturnValue(new Promise(yes => { resolve = yes; })), updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn() };
    render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={auth(true)} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByRole("navigation", { name: "CMS sections" });
    expect(await screen.findByText("Loading Profile…")).toBeTruthy();
    expect(screen.queryByText("Demo User")).toBeNull();
    resolve(mapResumeRows(databaseRows()));
    expect((await screen.findByLabelText("English Name") as HTMLInputElement).value).toBe("Actual Name");
    expect(screen.getByText("PRODUCTION WRITE")).toBeTruthy();
  });

  it("shows an error on query failure and retries without signing out", async () => {
    const repository: ResumeRepository & Partial<ResumeSectionRepository> = {
      load: vi.fn().mockRejectedValue(new Error("full snapshot must not start")),
      loadSiteMetadata: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv", isPublished: false, updatedAt: null }),
      loadEducation: vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(mapResumeRows(databaseRows()).sections.education),
      updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    };
    const client = auth(true);
    render(<MemoryRouter initialEntries={["/education"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load Education.");
    expect(screen.queryByText("本科教育")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Education" })).toBeTruthy();
    expect(repository.loadEducation).toHaveBeenCalledTimes(2);
    expect(repository.load).not.toHaveBeenCalled();
    expect(client.signOut).not.toHaveBeenCalled();
  });

  it("ignores stale Stage 4B storage and keeps production Education drafts independent of fixture storage", () => {
    window.sessionStorage.setItem("example-cv-cms-fixture-education", JSON.stringify([{ id: "old", position: 0, translations: { en: { title: "Old fixture value" } } }]));
    const resume = mapResumeRows(databaseRows());
    const view = render(<MemoryRouter initialEntries={["/education"]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} /></MemoryRouter>);
    expect(screen.getByText("Actual Education")).toBeTruthy();
    expect(screen.queryByText("Old fixture value")).toBeNull();
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Temporary local title" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Actual Education");
    expect(window.sessionStorage.getItem("example-cv-cms-fixture-education")).toContain("Old fixture value");
    view.unmount();
    render(<MemoryRouter initialEntries={["/education"]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} /></MemoryRouter>);
    expect(screen.getByText("Actual Education")).toBeTruthy();
  });

  it("exposes explicit production save for Links and performs no write before Save", async () => {
    const db = mockSupabase(databaseRows());
    render(<MemoryRouter initialEntries={["/links"]}><AuthGate client={auth(true)} resumeRepository={createResumeRepository(db.client)} /></MemoryRouter>);
    const title = await screen.findByLabelText("GitHub label") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Local-only label" } });
    expect(screen.getByRole("button", { name: "Save production changes" })).toBeTruthy();
    expect(db.mutation).not.toHaveBeenCalled();
    expect(db.calls.every(call => call.selected === "*")).toBe(true);
  });

  it("unmounts production content after sign-out", async () => {
    const client = auth(true);
    const repository: ResumeRepository = { load: vi.fn().mockResolvedValue(mapResumeRows(databaseRows())), updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn() };
    render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByLabelText("English Name");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy());
    expect(screen.queryByLabelText("English Name")).toBeNull();
  });
});
