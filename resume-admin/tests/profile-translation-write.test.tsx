import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { App } from "../src/App";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import type { LoadedResume } from "../src/data/resumeMapper";
import { createResumeRepository, type ResumeRepository, type UpdatedProfileTranslationRow } from "../src/data/resumeRepository";
import { fixtureSections } from "../src/fixtures";
import type { Locale, ProfileTranslation } from "../src/model";

const resumeId = "loaded-resume-id";
const snapshot = (): LoadedResume => ({ resumeId, siteKey: "example-cv", isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) });
const confirmed = (locale: Locale, name: string): UpdatedProfileTranslationRow => ({
  resumeId, locale, updatedAt: "2026-09-24T00:00:00Z",
  translation: { ...fixtureSections.profile.translations[locale], name },
});
const editName = (locale: Locale, name: string) => fireEvent.change(screen.getByLabelText(`${locale === "zh" ? "Chinese" : "English"} Name`), { target: { value: name } });
const button = () => screen.getByRole("button", { name: "Save profile changes" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockRepository(update: ResumeRepository["updateProfileTranslation"] = vi.fn().mockResolvedValue(confirmed("zh", "新名字"))): ResumeRepository {
  return { load: vi.fn().mockResolvedValue(snapshot()),
    updateProfileSharedDetails: vi.fn(async (_id, shared) => ({ resumeId, shared, updatedAt: null })),
    updateProfileTranslation: update };
}

function showProfile(repository: ResumeRepository, onTranslationSaved = vi.fn()) {
  return render(<MemoryRouter initialEntries={["/profile"]}><App identityEmail="admin@example.test"
    onSignOut={() => {}} signOutPending={false} signOutError="" resume={snapshot()}
    repository={repository} onProfileSaved={() => {}} onProfileTranslationSaved={onTranslationSaved} /></MemoryRouter>);
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Stage 4F repository translation boundary", () => {
  it.each(["zh", "en"] as const)("updates %s by resume_id and locale using only the seven translation columns", async locale => {
    const row = confirmed(locale, "Changed");
    const single = vi.fn().mockResolvedValue({ data: {
      resume_id: resumeId, locale,
      name: row.translation.name, nav_about_label: row.translation.navAboutLabel,
      email_action_label: row.translation.emailActionLabel, graduation_label: row.translation.graduationLabel,
      avatar_label: row.translation.avatarLabel, contact_focus_heading: row.translation.contactFocusHeading,
      contact_status_heading: row.translation.contactStatusHeading, updated_at: row.updatedAt,
    }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const secondEq = vi.fn().mockReturnValue({ select });
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
    const update = vi.fn().mockReturnValue({ eq: firstEq });
    const from = vi.fn().mockReturnValue({ update });
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const extra = { ...row.translation, resume_id: "wrong", locale: locale === "zh" ? "en" : "zh", graduationValue: "forbidden" };
    expect(await repo.updateProfileTranslation(resumeId, locale, extra)).toEqual(row);
    expect(from).toHaveBeenCalledExactlyOnceWith("resume_profile_translations");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      name: "Changed", nav_about_label: row.translation.navAboutLabel,
      email_action_label: row.translation.emailActionLabel, graduation_label: row.translation.graduationLabel,
      avatar_label: row.translation.avatarLabel, contact_focus_heading: row.translation.contactFocusHeading,
      contact_status_heading: row.translation.contactStatusHeading,
    });
    expect(firstEq).toHaveBeenCalledExactlyOnceWith("resume_id", resumeId);
    expect(secondEq).toHaveBeenCalledExactlyOnceWith("locale", locale);
    expect(select).toHaveBeenCalledExactlyOnceWith("resume_id,locale,name,nav_about_label,email_action_label,graduation_label,avatar_label,contact_focus_heading,contact_status_heading,updated_at");
    expect(single).toHaveBeenCalledOnce();
  });

  it("renders one Profile-level action area for all three content sections", () => {
    showProfile(mockRepository());
    expect(document.querySelectorAll(".profile-translation-footer")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Save profile changes" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancel changes" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Shared information" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Profile content" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Chinese content" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "English content" })).toBeNull();
    const content = screen.getByRole("heading", { name: "Profile content" }).closest("section")!;
    expect(within(content).getByText("Chinese", { selector: ".bilingual-column-headings span[lang='zh']" })).toBeTruthy();
    expect(within(content).getByText("English", { selector: ".bilingual-column-headings span[lang='en']" })).toBeTruthy();
    const rows = Array.from(content.querySelectorAll<HTMLElement>(".bilingual-field-pair"));
    expect(rows.map(row => row.querySelector("h3")?.textContent)).toEqual([
      "Name", "About navigation label", "Email action label", "Graduation label", "Avatar accessibility label", "Current Focus heading", "Current Status heading",
    ]);
    for (const row of rows) {
      const fields = Array.from(row.querySelectorAll<HTMLElement>(".bilingual-field-values .field"));
      expect(fields).toHaveLength(2);
      expect(fields.map(field => field.querySelector("label span[aria-hidden='true']")?.textContent)).toEqual(["中文", "EN"]);
    }
    expect(within(rows[0]).getByLabelText("Chinese Name")).toBeTruthy();
    expect(within(rows[0]).getByLabelText("English Name")).toBeTruthy();
    expect((within(rows[0]).getByLabelText("Chinese Name") as HTMLInputElement).value).toBe(fixtureSections.profile.translations.zh.name);
    expect((within(rows[0]).getByLabelText("English Name") as HTMLInputElement).value).toBe(fixtureSections.profile.translations.en.name);
    expect(screen.getByRole("button", { name: "Save profile changes" }).hasAttribute("disabled")).toBe(true);
  });

  it("uses whitespace between Profile field pairs while retaining structural and input rules", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const pairRules = [...css.matchAll(/\.profile-editor-form \.profile-editor-locale \.bilingual-field-pair\{([^}]*)\}/g)].map(match => match[1]);
    const actionRule = css.match(/\.profile-editor-form \.save-bar\{([^}]*)\}/)?.[1] ?? "";
    expect(pairRules.length).toBeGreaterThan(0);
    expect(pairRules.join(" ")).not.toContain("border-bottom");
    expect(pairRules.join(" ")).toContain("padding:");
    expect(css).toMatch(/\.profile-editor-form \.profile-editor-locale \.bilingual-field-values \.field label>span\[aria-hidden=true\]\{display:none\}/);
    expect(css).toMatch(/@media\(max-width:680px\)\{[\s\S]*?\.profile-editor-form \.profile-editor-locale \.bilingual-field-values \.field label>span\[aria-hidden=true\]\{display:inline\}/);
    expect(actionRule).toContain("border-top:0");
    expect(css).toMatch(/\.profile-editor-form \.profile-editor-section\{[^}]*border-top:1px solid/);
    expect(css).toMatch(/\.field input\{[^}]*border-bottom:1px solid/);
  });

  it("rejects unsupported locales, invalid fields, missing rows, and mismatched row identities", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn().mockReturnValue({ update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single }) }) }) }) });
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const input = fixtureSections.profile.translations.zh;
    await expect(repo.updateProfileTranslation(resumeId, "fr" as Locale, input)).rejects.toThrow("Invalid profile locale");
    await expect(repo.updateProfileTranslation(resumeId, "zh", { ...input, name: null } as unknown as ProfileTranslation)).rejects.toThrow("Invalid profile translation");
    expect(from).not.toHaveBeenCalled();
    await expect(repo.updateProfileTranslation(resumeId, "zh", input)).rejects.toThrow("not confirmed");
    single.mockResolvedValue({ data: { resume_id: resumeId, locale: "en" }, error: null });
    await expect(repo.updateProfileTranslation(resumeId, "zh", input)).rejects.toThrow("not confirmed");
  });
});

describe("unified Profile save", () => {
  it("saves only the dirty locale and leaves the other domains untouched", async () => {
    const repository = mockRepository();
    showProfile(repository);
    editName("zh", "中文新名字");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(button().hasAttribute("disabled")).toBe(false);
    fireEvent.click(button());
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
    expect(repository.updateProfileTranslation).toHaveBeenCalledExactlyOnceWith(resumeId, "zh", { ...fixtureSections.profile.translations.zh, name: "中文新名字" });
  });

  it.each(["zh", "en"] as const)("waits for %s confirmation, blocks duplicates, and advances its baseline", async locale => {
    const pending = deferred<UpdatedProfileTranslationRow>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    showProfile(mockRepository(update), onSaved);
    const language = locale === "zh" ? "Chinese" : "English";
    const changed = locale === "zh" ? "中文新名字" : "New English Name";
    editName(locale, changed);
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(update).toHaveBeenCalledExactlyOnceWith(resumeId, locale, { ...fixtureSections.profile.translations[locale], name: changed });
    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
    pending.resolve(confirmed(locale, changed));
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(button().hasAttribute("disabled")).toBe(true);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(confirmed(locale, changed));
    editName(locale, "Another edit");
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText(`${language} Name`) as HTMLInputElement).value).toBe(changed);
  });

  it.each(["zh", "en"] as const)("keeps %s edits after failure and permits retry", async locale => {
    const changed = locale === "zh" ? "中文新名字" : "New English Name";
    const update = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(confirmed(locale, changed));
    showProfile(mockRepository(update));
    editName(locale, changed);
    fireEvent.click(button());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Profile changes were not saved. Your edits remain; please retry.");
    expect((screen.getByLabelText(`${locale === "zh" ? "Chinese" : "English"} Name`) as HTMLInputElement).value).toBe(changed);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(button());
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it.each(["zh", "en"] as const)("reports partial failure and retries only the remaining %s domain", async winner => {
    const loser: Locale = winner === "zh" ? "en" : "zh";
    const winnerName = winner === "zh" ? "中文新名字" : "New English Name";
    const loserName = loser === "zh" ? "中文新名字" : "New English Name";
    const update = vi.fn((_resumeId: string, locale: Locale) => locale === winner
      ? Promise.resolve(confirmed(winner, winnerName))
      : Promise.reject(new Error("network")));
    showProfile(mockRepository(update));
    editName("zh", "中文新名字");
    editName("en", "New English Name");
    fireEvent.click(button());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Some Profile changes could not be saved. Saved changes are kept; remaining changes are still unsaved.");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect((screen.getByLabelText(`${loser === "zh" ? "Chinese" : "English"} Name`) as HTMLInputElement).value).toBe(loserName);
    expect(update).toHaveBeenCalledTimes(2);
    update.mockImplementation((_resumeId: string, locale: Locale) => Promise.resolve(confirmed(locale, loserName)));
    fireEvent.click(button());
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(3);
    expect(update.mock.calls.filter(call => call[1] === winner)).toHaveLength(1);
  });

  it("saves all dirty Profile domains through one action", async () => {
    const update = vi.fn(async (_id: string, locale: Locale, translation: ProfileTranslation) => ({ resumeId, locale, translation, updatedAt: null }));
    const repository = mockRepository(update);
    showProfile(repository);
    editName("zh", "中文新名字");
    editName("en", "New English Name");
    fireEvent.change(screen.getByLabelText("Graduation value"), { target: { value: "2035" } });
    fireEvent.click(button());
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(repository.updateProfileSharedDetails).toHaveBeenCalledOnce();
    expect(repository.updateProfileTranslation).toHaveBeenCalledTimes(2);
    expect(repository.updateProfileTranslation).toHaveBeenCalledWith(resumeId, "zh", { ...fixtureSections.profile.translations.zh, name: "中文新名字" });
    expect(repository.updateProfileTranslation).toHaveBeenCalledWith(resumeId, "en", { ...fixtureSections.profile.translations.en, name: "New English Name" });
    expect(button().hasAttribute("disabled")).toBe(true);
  });

  it("keeps a missing English row empty and reports an UPDATE failure without creating it", async () => {
    const resume = snapshot();
    resume.sections.profile.translations.en = { name: "", navAboutLabel: "", emailActionLabel: "", graduationLabel: "", avatarLabel: "", contactFocusHeading: "", contactStatusHeading: "" };
    const update = vi.fn().mockRejectedValue(new Error("missing row"));
    const repository = mockRepository(update);
    render(<MemoryRouter initialEntries={["/profile"]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} repository={repository} onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter>);
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("");
    editName("en", "New English Name");
    fireEvent.click(button());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Profile changes were not saved. Your edits remain; please retry.");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("New English Name");
    expect(update).toHaveBeenCalledOnce();
  });

  it("keeps confirmed translation values after section navigation", async () => {
    const repository = mockRepository(vi.fn().mockResolvedValue(confirmed("zh", "中文新名字")));
    const client: AdminAuthClient = { getIdentity: vi.fn().mockResolvedValue({ id: "admin-id", email: "admin@example.test", sessionKey: "admin-session" }), isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(), subscribe: vi.fn().mockReturnValue(() => {}) };
    render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByLabelText("Chinese Name");
    editName("zh", "中文新名字");
    fireEvent.click(button());
    await screen.findByText("Profile changes saved.");
    fireEvent.click(screen.getByRole("navigation", { name: "CMS sections" }).querySelector('a[href="/overview"]')!);
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("navigation", { name: "CMS sections" }).querySelector('a[href="/profile"]')!);
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("中文新名字");
    expect(button().hasAttribute("disabled")).toBe(true);
  });

  it("does not expose Profile save to a non-admin and leaves non-Profile sections local-only", async () => {
    const update = vi.fn();
    const repository = mockRepository(update);
    const client: AdminAuthClient = { getIdentity: vi.fn().mockResolvedValue({ id: "non-admin", email: "user@example.test", sessionKey: "user-session" }), isResumeAdmin: vi.fn().mockResolvedValue(false), signIn: vi.fn(), signOut: vi.fn(), subscribe: vi.fn().mockReturnValue(() => {}) };
    const view = render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Access denied" });
    expect(repository.load).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    view.unmount();
    render(<MemoryRouter initialEntries={["/links"]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" resume={snapshot()} repository={repository} onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("GitHub label"), { target: { value: "Local label" } });
    fireEvent.click(screen.getByRole("button", { name: "Save local draft" }));
    expect(update).not.toHaveBeenCalled();
  });
});
