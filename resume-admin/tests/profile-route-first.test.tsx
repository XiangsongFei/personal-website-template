import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient, AdminIdentity } from "../src/auth/supabase";
import type { LoadedResume, ResumeSiteMetadata } from "../src/data/resumeMapper";
import { createResumeRepository, type ResumeRepository, type ResumeSectionRepository, type UpdatedProfileRow, type UpdatedProfileTranslationRow } from "../src/data/resumeRepository";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const identity: AdminIdentity = { id: "route-admin", email: "admin@example.test", sessionKey: "route-session" };
const resumeId = "profile-resume-id";
const metadata: ResumeSiteMetadata = { resumeId, siteKey: "example-cv", isPublished: true, updatedAt: "2026-09-25T00:00:00Z" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function snapshot(): LoadedResume {
  return { ...metadata, sections: structuredClone(fixtureSections) };
}

function repository(overrides: Partial<ResumeRepository & ResumeSectionRepository> = {}): ResumeRepository & ResumeSectionRepository {
  return {
    load: vi.fn().mockResolvedValue(snapshot()),
    loadSiteMetadata: vi.fn().mockResolvedValue(metadata),
    loadOverview: vi.fn().mockResolvedValue({ profileName: fixtureSections.profile.translations.en.name }),
    loadProfile: vi.fn().mockResolvedValue(structuredClone(fixtureSections.profile)),
    loadIntroduction: vi.fn().mockResolvedValue(fixtureSections.introduction),
    loadEducation: vi.fn().mockResolvedValue(fixtureSections.education),
    loadExperience: vi.fn().mockResolvedValue(fixtureSections.experience),
    loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects),
    loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards),
    loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(fixtureSections.links),
    updateProfileSharedDetails: vi.fn(async (_id, shared) => ({ resumeId, shared, updatedAt: null })),
    updateProfileTranslation: vi.fn(async (_id, locale, translation) => ({ resumeId, locale, translation, updatedAt: null })),
    ...overrides,
  };
}

function authClient(session: AdminIdentity | null = identity) {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  const client: AdminAuthClient = {
    getIdentity: vi.fn().mockResolvedValue(session),
    signIn: vi.fn().mockResolvedValue(undefined),
    isResumeAdmin: vi.fn().mockResolvedValue(true),
    signOut: vi.fn(async () => { listener?.("SIGNED_OUT", null); }),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }),
  };
  return { client, emit: (event: string, key: string | null) => listener?.(event, key) };
}

function show(repo: ResumeRepository, path = "/profile", store = new ResumeSectionStore(), strict = false) {
  const auth = authClient();
  const app = <UiLocaleProvider><MemoryRouter initialEntries={[path]}><AuthGate client={auth.client} resumeRepository={repo} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), auth, store };
}

const go = (section: string) => fireEvent.click(screen.getAllByRole("link", { name: section })[0]);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const inputValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.removeItem(UI_LOCALE_KEY);
  vi.restoreAllMocks();
});

describe("route-first Profile loading", () => {
  it("cold /profile reads only site metadata and Profile, never the full snapshot or unrelated sections", async () => {
    const reads: string[] = [];
    const row = (fields: Record<string, unknown>) => ({ resume_id: resumeId, ...fields });
    const tableRows: Record<string, Record<string, unknown>[]> = {
      resume_profile: [row({ graduation_value: "2024", avatar_initials: "XY", footer_name: "Actual", copyright: "© Actual" })],
      resume_profile_translations: (["zh", "en"] as const).map(locale => row({ locale, name: locale === "zh" ? "真实姓名" : "Actual Name", nav_about_label: "About", email_action_label: "Email", graduation_label: "Graduation", avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status" })),
    };
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => ({ eq: vi.fn(() => {
        reads.push(table);
        const response = { data: table === "resume_sites" ? { id: resumeId, site_key: "example-cv", is_published: true, updated_at: metadata.updatedAt } : tableRows[table] ?? [], error: null };
        return table === "resume_sites" ? { maybeSingle: async () => response } : Promise.resolve(response);
      }) })),
      update: vi.fn(), insert: vi.fn(), delete: vi.fn(),
    }));
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const fullLoad = vi.spyOn(repo, "load");
    const app = show(repo, "/profile", new ResumeSectionStore(), true);
    await screen.findByLabelText("English Name");
    expect(reads).toEqual(["resume_sites", "resume_profile", "resume_profile_translations"]);
    expect(fullLoad).not.toHaveBeenCalled();
    expect(app.auth.client.isResumeAdmin).toHaveBeenCalledOnce();
  });

  it("mounts the authenticated shell while Profile alone is loading", async () => {
    const pending = deferred<typeof fixtureSections.profile>();
    const repo = repository({ loadProfile: vi.fn(() => pending.promise) });
    show(repo);
    expect(await screen.findByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading Profile…");
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Loading resume content…" })).toBeNull();
    expect(repo.load).not.toHaveBeenCalled();
    pending.resolve(structuredClone(fixtureSections.profile));
    expect(await screen.findByLabelText("English Name")).toBeTruthy();
  });

  it("localizes Profile loading, error, and retry in English and Chinese", async () => {
    for (const locale of ["en", "zh"] as const) {
      cleanup();
      window.localStorage.setItem(UI_LOCALE_KEY, locale);
      const failed = deferred<typeof fixtureSections.profile>();
      void failed.promise.catch(() => {});
      const repo = repository({ loadProfile: vi.fn().mockReturnValueOnce(failed.promise).mockResolvedValue(structuredClone(fixtureSections.profile)) });
      show(repo);
      await screen.findByRole("navigation", { name: locale === "en" ? "CMS sections" : "CMS 模块" });
      expect(screen.getByRole("status").textContent).toBe(locale === "en" ? "Loading Profile…" : "正在加载个人资料……");
      failed.reject(new Error("temporary"));
      expect((await screen.findByRole("alert")).textContent).toContain(locale === "en" ? "Unable to load Profile." : "无法加载个人资料。");
      expect(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重试" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重试" }));
      expect(await screen.findByLabelText(locale === "en" ? "English Name" : "英文 姓名")).toBeTruthy();
      expect(repo.loadProfile).toHaveBeenCalledTimes(2);
      expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
      expect(repo.load).not.toHaveBeenCalled();
      expect(repo.loadEducation).not.toHaveBeenCalled();
    }
  });

  it("reuses cached Profile after navigation and does not reload on UI locale changes", async () => {
    const repo = repository();
    show(repo);
    await screen.findByLabelText("English Name");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByLabelText("英文 姓名")).toBeTruthy();
    expect(repo.loadProfile).toHaveBeenCalledOnce();
    go("教育经历");
    expect(await screen.findByRole("heading", { name: "教育经历" })).toBeTruthy();
    expect(repo.load).not.toHaveBeenCalled();
    expect(repo.loadEducation).toHaveBeenCalledOnce();
    go("个人资料");
    expect(await screen.findByLabelText("英文 姓名")).toBeTruthy();
    expect(repo.loadProfile).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
  });

  it.each([
    ["Graduation value", "2031", "graduationValue"],
    ["Chinese Current Focus heading", "当前关注测试", "zh"],
    ["English Current Status heading", "Current Status test", "en"],
  ])("preserves dirty Profile draft %s through route-first Overview navigation", async (label, value, slice) => {
    const repo = repository();
    show(repo);
    await screen.findByLabelText("English Name");
    change(label, value);
    go("Overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(repo.loadOverview).toHaveBeenCalledOnce());
    expect(repo.load).not.toHaveBeenCalled();
    go("Profile");
    expect(inputValue(label)).toBe(value);
    expect(repo.loadProfile).toHaveBeenCalledOnce();
    expect(slice).toBeTruthy();
  });

  it("retries only Profile after a section failure and keeps site metadata cached", async () => {
    const repo = repository({ loadProfile: vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValue(structuredClone(fixtureSections.profile)) });
    show(repo);
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load Profile.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByLabelText("English Name");
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.loadProfile).toHaveBeenCalledTimes(2);
    expect(repo.load).not.toHaveBeenCalled();
    for (const section of ["loadOverview", "loadIntroduction", "loadEducation", "loadExperience", "loadProjects", "loadSkills", "loadAwards", "loadContact", "loadLinks"] as const) {
      expect(repo[section]).not.toHaveBeenCalled();
    }
  });

  it("patches only the successfully saved Profile cache slice", async () => {
    const store = new ResumeSectionStore();
    store.setSession(identity.sessionKey);
    const updatedShared: UpdatedProfileRow = { resumeId, shared: { ...fixtureSections.profile.shared, graduationValue: "2035" }, updatedAt: "confirmed" };
    const updatedZh: UpdatedProfileTranslationRow = { resumeId, locale: "zh", translation: { ...fixtureSections.profile.translations.zh, name: "新中文名" }, updatedAt: "confirmed" };
    const updatedEn: UpdatedProfileTranslationRow = { resumeId, locale: "en", translation: { ...fixtureSections.profile.translations.en, name: "New English Name" }, updatedAt: "confirmed" };
    const repo = repository({
      updateProfileSharedDetails: vi.fn().mockResolvedValue(updatedShared),
      updateProfileTranslation: vi.fn(async (_id, locale) => locale === "zh" ? updatedZh : updatedEn),
    });
    show(repo, "/profile", store);
    await screen.findByLabelText("English Name");
    change("Graduation value", "2035");
    fireEvent.click(screen.getByRole("button", { name: "Save shared details" }));
    await screen.findByText("Shared profile details saved to production.");
    let cached = store.getSectionState(identity.sessionKey, resumeId, "profile");
    expect(cached).toMatchObject({ status: "loaded", value: { shared: updatedShared.shared, translations: fixtureSections.profile.translations } });

    change("Chinese Name", "新中文名");
    fireEvent.click(screen.getByRole("button", { name: "Save Chinese" }));
    await screen.findByText("Chinese profile translation saved to production.");
    cached = store.getSectionState(identity.sessionKey, resumeId, "profile");
    expect(cached).toMatchObject({ status: "loaded", value: { shared: updatedShared.shared, translations: { zh: updatedZh.translation, en: fixtureSections.profile.translations.en } } });

    change("English Name", "New English Name");
    fireEvent.click(screen.getByRole("button", { name: "Save English" }));
    await screen.findByText("English profile translation saved to production.");
    cached = store.getSectionState(identity.sessionKey, resumeId, "profile");
    expect(cached).toMatchObject({ status: "loaded", value: { shared: updatedShared.shared, translations: { zh: updatedZh.translation, en: updatedEn.translation } } });
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("keeps all three Cancel boundaries local and restores confirmed values without reads", async () => {
    const repo = repository();
    show(repo);
    await screen.findByLabelText("English Name");
    change("Graduation value", "temporary shared");
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(inputValue("Graduation value")).toBe(fixtureSections.profile.shared.graduationValue);
    change("Chinese Name", "临时中文名");
    fireEvent.click(screen.getByRole("button", { name: "Cancel Chinese" }));
    expect(inputValue("Chinese Name")).toBe(fixtureSections.profile.translations.zh.name);
    change("English Name", "Temporary English name");
    fireEvent.click(screen.getByRole("button", { name: "Cancel English" }));
    expect(inputValue("English Name")).toBe(fixtureSections.profile.translations.en.name);
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.loadProfile).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("invalidates Profile data on sign-out and reloads it for a changed session", async () => {
    const store = new ResumeSectionStore();
    const repo = repository();
    const auth = authClient();
    const view = render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={auth.client} resumeRepository={repo} sectionStore={store} /></MemoryRouter>);
    await screen.findByLabelText("English Name");
    expect(store.getSectionState(identity.sessionKey, resumeId, "profile").status).toBe("loaded");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(store.getSectionState(identity.sessionKey, resumeId, "profile").status).toBe("idle");
    view.unmount();

    const secondIdentity = { ...identity, id: "other-admin", sessionKey: "other-session" };
    vi.mocked(auth.client.getIdentity).mockResolvedValue(secondIdentity);
    const secondView = render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={auth.client} resumeRepository={repo} sectionStore={store} /></MemoryRouter>);
    await screen.findByLabelText("English Name");
    expect(repo.loadProfile).toHaveBeenCalledTimes(2);
    expect(store.getSectionState(secondIdentity.sessionKey, resumeId, "profile").status).toBe("loaded");
    secondView.unmount();
  });

  it("loads Overview route-first with a separate cache entry", async () => {
    const repo = repository();
    show(repo, "/overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    expect(repo.loadProfile).not.toHaveBeenCalled();
  });
});
