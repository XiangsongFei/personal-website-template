import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient, AdminIdentity } from "../src/auth/supabase";
import type { LoadedResume, ResumeSiteMetadata } from "../src/data/resumeMapper";
import { createResumeRepository, type ResumeRepository, type ResumeSectionRepository } from "../src/data/resumeRepository";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "education-resume-id";
const identity: AdminIdentity = { id: "route-admin", email: "admin@example.test", sessionKey: "education-session" };
const metadata: ResumeSiteMetadata = { resumeId, siteKey: "example-cv", isPublished: true, updatedAt: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function snapshot(): LoadedResume { return { ...metadata, sections: structuredClone(fixtureSections) }; }

function repository(overrides: Partial<ResumeRepository & ResumeSectionRepository> = {}): ResumeRepository & ResumeSectionRepository {
  return {
    load: vi.fn().mockResolvedValue(snapshot()),
    loadSiteMetadata: vi.fn().mockResolvedValue(metadata),
    loadOverview: vi.fn().mockResolvedValue({ profileName: "Name" }),
    loadProfile: vi.fn().mockResolvedValue(structuredClone(fixtureSections.profile)),
    loadIntroduction: vi.fn().mockResolvedValue(fixtureSections.introduction),
    loadEducation: vi.fn().mockResolvedValue(structuredClone(fixtureSections.education)),
    loadExperience: vi.fn().mockResolvedValue(fixtureSections.experience),
    loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects),
    loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards),
    loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(fixtureSections.links),
    updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    updateEducationEntry: vi.fn(), updateEducationTranslation: vi.fn(), insertEducationEntry: vi.fn(),
    insertEducationTranslation: vi.fn(), readEducationTranslation: vi.fn(), deleteEducationEntry: vi.fn(),
    ...overrides,
  };
}

function authClient(): AdminAuthClient {
  return {
    getIdentity: vi.fn().mockResolvedValue(identity), isResumeAdmin: vi.fn().mockResolvedValue(true),
    signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

function show(repo: ResumeRepository, path = "/education", strict = false, store = new ResumeSectionStore()) {
  const auth = authClient();
  const app = <UiLocaleProvider><MemoryRouter initialEntries={[path]}><AuthGate client={auth} resumeRepository={repo} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), auth, store };
}

const go = (section: string) => fireEvent.click(screen.getByRole("link", { name: section }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks();
});

describe("Phase 4 route-first Education loading", () => {
  it("cold /education reads only site metadata and Education tables, including StrictMode, and never starts the full snapshot", async () => {
    const reads: string[] = [];
    const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
      reads.push(table);
      if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: true, updated_at: null }, error: null }) };
      if (table === "resume_education_entries") return Promise.resolve({ data: [{ id: "edu-id", resume_id: resumeId, source_key: "stable-key", position: 0, entry_type: "summerSchool" }], error: null });
      if (table === "resume_education_translations") return Promise.resolve({ data: (["zh", "en"] as const).map(locale => ({ resume_id: resumeId, education_entry_id: "edu-id", locale, title: `${locale} title`, program: "program", period: "period", grade: "grade", course_title: null, course_description: null })), error: null });
      throw new Error(`Unexpected Data API table: ${table}`);
    }) })), update: vi.fn(), insert: vi.fn(), delete: vi.fn() }));
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const full = vi.spyOn(repo, "load");
    show(repo, "/education", true);
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    expect(reads).toEqual(["resume_sites", "resume_education_entries", "resume_education_translations"]);
    expect(full).not.toHaveBeenCalled();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    expect(screen.getByDisplayValue("en title")).toBeTruthy();
  });

  it("keeps the authenticated shell mounted and shows localized Education loading and error only in the content area, then retries Education", async () => {
    for (const locale of ["en", "zh"] as const) {
      cleanup(); window.localStorage.setItem(UI_LOCALE_KEY, locale);
      const pending = deferred<typeof fixtureSections.education>();
      void pending.promise.catch(() => {});
      const repo = repository({ loadEducation: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(structuredClone(fixtureSections.education)) });
      show(repo);
      expect(await screen.findByRole("navigation", { name: locale === "en" ? "CMS sections" : "CMS 模块" })).toBeTruthy();
      expect(screen.getByRole("banner")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(locale === "en" ? "Loading Education..." : "正在加载教育经历……");
      expect(screen.queryByRole("heading", { name: "Loading resume content…" })).toBeNull();
      pending.reject(new Error("temporary"));
      expect((await screen.findByRole("alert")).textContent).toContain(locale === "en" ? "Unable to load Education." : "无法加载教育经历。");
      fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重试" }));
      expect(await screen.findByLabelText(locale === "en" ? "English Title" : "英文 标题")).toBeTruthy();
      expect(repo.loadEducation).toHaveBeenCalledTimes(2);
      expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
      expect(repo.load).not.toHaveBeenCalled();
      expect(repo.loadProfile).not.toHaveBeenCalled();
      expect(repo.loadProjects).not.toHaveBeenCalled();
    }
  });

  it("coalesces Education reads, retains caches and editor drafts across Profile navigation and UI locale changes", async () => {
    const pending = deferred<typeof fixtureSections.education>();
    const repo = repository({ loadEducation: vi.fn(() => pending.promise) });
    const app = show(repo, "/education", true);
    await screen.findByRole("navigation", { name: "CMS sections" });
    go("Profile");
    expect(await screen.findByLabelText("English Name")).toBeTruthy();
    go("Education");
    pending.resolve(structuredClone(fixtureSections.education));
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    change("Chinese Title", "Draft title");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByLabelText("中文 标题")).toBeTruthy();
    go("个人资料");
    expect(await screen.findByLabelText("英文 姓名")).toBeTruthy();
    go("教育经历");
    expect((screen.getByLabelText("中文 标题") as HTMLInputElement).value).toBe("Draft title");
    expect(repo.load).not.toHaveBeenCalled();
    expect(repo.loadEducation).toHaveBeenCalledOnce();
    expect(repo.loadProfile).toHaveBeenCalledOnce();
    expect(app.store.getSectionState(identity.sessionKey, resumeId, "education").status).toBe("loaded");
  });

  it("preserves a dirty Education draft across route-first Overview navigation", async () => {
    const repo = repository(); show(repo);
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    change("English Title", "Unsaved title");
    go("Overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("link", { name: "Education" })[0]);
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Unsaved title");
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("patches only the Education cache after a confirmed translation save", async () => {
    const initial = structuredClone(fixtureSections.education);
    const first = initial[0];
    const repo = repository({
      loadEducation: vi.fn().mockResolvedValue(initial),
      updateEducationTranslation: vi.fn(async (_resume, entryId, locale, translation) => ({ resumeId, entryId, locale, translation })),
    });
    const { store } = show(repo);
    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    change("English Title", "Confirmed Education title");
    fireEvent.click(screen.getByRole("button", { name: "Save Education changes" }));
    expect(await screen.findByText("Education changes saved to production.")).toBeTruthy();
    const cached = store.getSectionState(identity.sessionKey, resumeId, "education");
    expect(cached.status).toBe("loaded");
    if (cached.status === "loaded") expect(cached.value.find(item => item.id === first.id)?.translations.en.title).toBe("Confirmed Education title");
    expect(store.getSectionState(identity.sessionKey, resumeId, "profile").status).toBe("idle");
    expect(repo.load).not.toHaveBeenCalled();
  });
});
