import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const button = (locale: Locale) => screen.getByRole("button", { name: `Save ${locale === "zh" ? "Chinese" : "English"}` });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockRepository(update: ResumeRepository["updateProfileTranslation"] = vi.fn().mockResolvedValue(confirmed("zh", "新名字"))): ResumeRepository {
  return { load: vi.fn().mockResolvedValue(snapshot()), updateProfileSharedDetails: vi.fn(), updateProfileTranslation: update };
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

  it("keeps translation status, actions, and helper text in separate spaced footer rows for both locales", () => {
    showProfile(mockRepository());
    const footers = document.querySelectorAll(".profile-translation-footer");
    expect(footers).toHaveLength(2);
    for (const footer of footers) {
      expect(footer.children).toHaveLength(3);
      expect(footer.children[0].classList.contains("state-pill")).toBe(true);
      expect(footer.children[1].classList.contains("save-actions")).toBe(true);
      expect(footer.children[2].classList.contains("save-notice")).toBe(true);
    }
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

describe("Stage 4F independent language saves", () => {
  it("tracks Chinese and English dirtiness independently", () => {
    showProfile(mockRepository());
    editName("zh", "中文新名字");
    expect(screen.getByText("Unsaved Chinese changes")).toBeTruthy();
    expect(button("zh").hasAttribute("disabled")).toBe(false);
    expect(button("en").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Save shared details" }).hasAttribute("disabled")).toBe(true);
    editName("en", "New English Name");
    expect(screen.getByText("Unsaved English changes")).toBeTruthy();
    expect(button("en").hasAttribute("disabled")).toBe(false);
  });

  it.each(["zh", "en"] as const)("waits for %s confirmation, blocks duplicates, and advances only that baseline", async locale => {
    const pending = deferred<UpdatedProfileTranslationRow>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    showProfile(mockRepository(update), onSaved);
    const language = locale === "zh" ? "Chinese" : "English";
    const changed = locale === "zh" ? "中文新名字" : "New English Name";
    editName(locale, changed);
    fireEvent.click(button(locale));
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(update).toHaveBeenCalledExactlyOnceWith(resumeId, locale, { ...fixtureSections.profile.translations[locale], name: changed });
    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(`Unsaved ${language} changes`)).toBeTruthy();
    expect(screen.queryByText(`${language} profile translation saved to production.`)).toBeNull();
    pending.resolve(confirmed(locale, changed));
    expect(await screen.findByText(`${language} profile translation saved to production.`)).toBeTruthy();
    expect(screen.getByText(`No unsaved ${language} changes`)).toBeTruthy();
    expect(button(locale).hasAttribute("disabled")).toBe(true);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(confirmed(locale, changed));
    editName(locale, "Another edit");
    fireEvent.click(screen.getByRole("button", { name: `Cancel ${language}` }));
    expect((screen.getByLabelText(`${language} Name`) as HTMLInputElement).value).toBe(changed);
  });

  it.each(["zh", "en"] as const)("keeps %s edits after failure and permits retry", async locale => {
    const language = locale === "zh" ? "Chinese" : "English";
    const changed = locale === "zh" ? "中文新名字" : "New English Name";
    const update = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(confirmed(locale, changed));
    showProfile(mockRepository(update));
    editName(locale, changed);
    fireEvent.click(button(locale));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", `${language} profile translation was not saved. Your edits remain; please retry.`);
    expect((screen.getByLabelText(`${language} Name`) as HTMLInputElement).value).toBe(changed);
    expect(screen.getByText(`Unsaved ${language} changes`)).toBeTruthy();
    fireEvent.click(button(locale));
    expect(await screen.findByText(`${language} profile translation saved to production.`)).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it.each(["zh", "en"] as const)("shows honest partial failure when %s succeeds and the other language fails", async winner => {
    const loser: Locale = winner === "zh" ? "en" : "zh";
    const winnerName = winner === "zh" ? "中文新名字" : "New English Name";
    const loserName = loser === "zh" ? "中文新名字" : "New English Name";
    const update = vi.fn((_resumeId: string, locale: Locale) => locale === winner
      ? Promise.resolve(confirmed(winner, winnerName))
      : Promise.reject(new Error("network")));
    showProfile(mockRepository(update));
    editName("zh", "中文新名字");
    editName("en", "New English Name");
    fireEvent.click(button("zh"));
    fireEvent.click(button("en"));
    const winnerLanguage = winner === "zh" ? "Chinese" : "English";
    const loserLanguage = loser === "zh" ? "Chinese" : "English";
    expect(await screen.findByText(`${winnerLanguage} profile translation saved to production.`)).toBeTruthy();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", `${loserLanguage} profile translation was not saved. Your edits remain; please retry.`);
    expect(screen.getByText(`No unsaved ${winnerLanguage} changes`)).toBeTruthy();
    expect(screen.getByText(`Unsaved ${loserLanguage} changes`)).toBeTruthy();
    expect((screen.getByLabelText(`${loserLanguage} Name`) as HTMLInputElement).value).toBe(loserName);
    expect(update).toHaveBeenCalledTimes(2);
    update.mockImplementation((_resumeId: string, locale: Locale) => Promise.resolve(confirmed(locale, loserName)));
    fireEvent.click(button(loser));
    expect(await screen.findByText(`${loserLanguage} profile translation saved to production.`)).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(3);
    expect(update.mock.calls.filter(call => call[1] === winner)).toHaveLength(1);
  });

  it("keeps a missing English row empty and reports an UPDATE failure without creating it", async () => {
    const resume = snapshot();
    resume.sections.profile.translations.en = {
      name: "", navAboutLabel: "", emailActionLabel: "", graduationLabel: "", avatarLabel: "",
      contactFocusHeading: "", contactStatusHeading: "",
    };
    const update = vi.fn().mockRejectedValue(new Error("missing row"));
    const repository = mockRepository(update);
    render(<MemoryRouter initialEntries={["/profile"]}><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume}
      repository={repository} onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter>);
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("");
    editName("en", "New English Name");
    fireEvent.click(button("en"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "English profile translation was not saved. Your edits remain; please retry.");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("New English Name");
    expect(update).toHaveBeenCalledOnce();
  });

  it("keeps confirmed translation values after section navigation", async () => {
    const repository = mockRepository(vi.fn().mockResolvedValue(confirmed("zh", "中文新名字")));
    const client: AdminAuthClient = {
      getIdentity: vi.fn().mockResolvedValue({ id: "admin-id", email: "admin@example.test", sessionKey: "admin-session" }),
      isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByLabelText("Chinese Name");
    editName("zh", "中文新名字");
    fireEvent.click(button("zh"));
    await screen.findByText("Chinese profile translation saved to production.");
    fireEvent.click(screen.getByRole("navigation", { name: "CMS sections" }).querySelector('a[href="/overview"]')!);
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("navigation", { name: "CMS sections" }).querySelector('a[href="/profile"]')!);
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe("中文新名字");
    expect(button("zh").hasAttribute("disabled")).toBe(true);
  });

  it("does not expose translation save to a non-admin and leaves non-Profile/Education sections local-only", async () => {
    const update = vi.fn();
    const repository = mockRepository(update);
    const client: AdminAuthClient = {
      getIdentity: vi.fn().mockResolvedValue({ id: "non-admin", email: "user@example.test", sessionKey: "user-session" }),
      isResumeAdmin: vi.fn().mockResolvedValue(false), signIn: vi.fn(), signOut: vi.fn(),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    const view = render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Access denied" });
    expect(repository.load).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    view.unmount();
    render(<MemoryRouter initialEntries={["/links"]}><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" resume={snapshot()}
      repository={repository} onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("GitHub label"), { target: { value: "Local label" } });
    fireEvent.click(screen.getByRole("button", { name: "Save local draft" }));
    expect(update).not.toHaveBeenCalled();
  });
});
