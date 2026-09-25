import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import type { ResumeRepository, ResumeSectionRepository } from "../src/data/resumeRepository";
import { createResumeRepository } from "../src/data/resumeRepository";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "phase5a-resume-id";
const specs = {
  introduction: { path: "/introduction", title: "Introduction", loader: "loadIntroduction", parents: "resume_intro_paragraphs", translations: "resume_intro_paragraph_translations", fk: "paragraph_id", input: "Chinese Paragraph", value: "Dirty introduction draft" },
  experience: { path: "/experience", title: "Experience", loader: "loadExperience", parents: "resume_experience_entries", translations: "resume_experience_translations", fk: "experience_entry_id", input: "Chinese Organization", value: "Dirty experience draft" },
  skills: { path: "/skills", title: "Skills", loader: "loadSkills", parents: "resume_skill_groups", translations: "resume_skill_group_translations", fk: "skill_group_id", input: "Chinese Group title", value: "Dirty skills draft" },
  awards: { path: "/awards", title: "Awards", loader: "loadAwards", parents: "resume_award_entries", translations: "resume_award_translations", fk: "award_entry_id", input: "Chinese Award name", value: "Dirty awards draft" },
} as const;
type Key = keyof typeof specs;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function auth(): AdminAuthClient {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin", email: "admin@example.test", sessionKey: "phase5a-session" }),
    isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(async () => listener?.("SIGNED_OUT", null)),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }) };
}

function repository(overrides: Partial<ResumeSectionRepository> = {}) {
  return {
    load: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) }),
    loadSiteMetadata: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null }),
    loadOverview: vi.fn().mockResolvedValue({ profileName: "Example" }),
    loadProfile: vi.fn().mockResolvedValue(fixtureSections.profile),
    loadIntroduction: vi.fn().mockResolvedValue(structuredClone(fixtureSections.introduction)),
    loadEducation: vi.fn().mockResolvedValue(structuredClone(fixtureSections.education)),
    loadExperience: vi.fn().mockResolvedValue(structuredClone(fixtureSections.experience)),
    loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects),
    loadSkills: vi.fn().mockResolvedValue(structuredClone(fixtureSections.skills)),
    loadAwards: vi.fn().mockResolvedValue(structuredClone(fixtureSections.awards)),
    loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(fixtureSections.links),
    updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    ...overrides,
  };
}

function show(repo: ResumeRepository, path: string, store = new ResumeSectionStore()) {
  const client = auth();
  const app = <UiLocaleProvider><MemoryRouter initialEntries={[path]}><AuthGate client={client} resumeRepository={repo} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(app), store };
}

const navigate = (name: string) => fireEvent.click(screen.getByRole("link", { name }));

function translationRow(key: Key, locale: "zh" | "en") {
  const common = { resume_id: resumeId, locale };
  switch (key) {
    case "introduction": return { ...common, paragraph_id: "entry", text: `${locale} introduction` };
    case "experience": return { ...common, experience_entry_id: "entry", organization: `${locale} organization`, title: "Role", period: "2024", description: "Description", location: null };
    case "skills": return { ...common, skill_group_id: "entry", title: `${locale} skills`, items: "One · Two" };
    case "awards": return { ...common, award_entry_id: "entry", name: `${locale} award`, year: "2024" };
  }
}

function parentRow() {
  return { id: "entry", resume_id: resumeId, position: 0, source_key: "source" };
}

afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Phase 5A route-first section loading", () => {
  it.each(Object.keys(specs) as Key[])("cold /%s reads only site, parent rows, and translations", async key => {
    const spec = specs[key];
    const reads: string[] = [];
    const parents = parentRow();
    const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
      reads.push(table);
      if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: true, updated_at: null }, error: null }) };
      if (table === spec.parents) return Promise.resolve({ data: [parents], error: null });
      if (table === spec.translations) return Promise.resolve({ data: (["zh", "en"] as const).map(locale => translationRow(key, locale)), error: null });
      throw new Error(`Unexpected table read ${table}`);
    }) })), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const fullLoad = vi.spyOn(repo, "load");
    show(repo, spec.path);
    const inputName = spec.input;
    expect(await screen.findByLabelText(inputName)).toBeTruthy();
    expect(reads).toEqual(["resume_sites", spec.parents, spec.translations]);
    expect(fullLoad).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
  });

  it.each(Object.keys(specs) as Key[])("retries only failed %s in both UI locales", async key => {
    const spec = specs[key];
    for (const locale of ["en", "zh"] as const) {
      cleanup(); window.localStorage.setItem(UI_LOCALE_KEY, locale);
      const pending = deferred<never>(); void pending.promise.catch(() => {});
      const repo = repository({ [spec.loader]: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(structuredClone(fixtureSections[key])) });
      show(repo as ReturnType<typeof repository>, spec.path);
      expect(await screen.findByRole("navigation", { name: locale === "en" ? "CMS sections" : "CMS 模块" })).toBeTruthy();
      expect(screen.getByRole("banner")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(locale === "en" ? `Loading ${spec.title}...` : ({ introduction: "正在加载个人简介……", experience: "正在加载工作经历……", skills: "正在加载技能……", awards: "正在加载荣誉奖项……" } as const)[key]);
      pending.reject(new Error("offline"));
      expect((await screen.findByRole("alert")).textContent).toContain(locale === "en" ? `Unable to load ${spec.title}.` : ({ introduction: "无法加载个人简介。", experience: "无法加载工作经历。", skills: "无法加载技能。", awards: "无法加载荣誉奖项。" } as const)[key]);
      fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Retry" : "重试" }));
      expect(await screen.findByLabelText(locale === "en" ? spec.input : ({ introduction: "中文 Paragraph", experience: "中文 组织", skills: "中文 分组标题", awards: "中文 荣誉名称" } as const)[key])).toBeTruthy();
      expect(repo.load).not.toHaveBeenCalled();
      expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
      for (const other of Object.keys(specs) as Key[]) if (other !== key) expect(repo[specs[other].loader]).not.toHaveBeenCalled();
    }
  });

  it("reuses migrated sections across navigation, metadata is shared, and no prefetch/full snapshot starts", async () => {
    const repo = repository();
    show(repo, "/introduction", new ResumeSectionStore());
    expect(await screen.findByLabelText("Chinese Paragraph")).toBeTruthy();
    navigate("Experience"); expect(await screen.findByLabelText("Chinese Organization")).toBeTruthy();
    navigate("Skills"); expect(await screen.findByLabelText("Chinese Group title")).toBeTruthy();
    navigate("Awards"); expect(await screen.findByLabelText("Chinese Award name")).toBeTruthy();
    navigate("Skills"); expect(await screen.findByLabelText("Chinese Group title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByLabelText("中文 分组标题")).toBeTruthy();
    expect(repo.load).not.toHaveBeenCalled();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.loadIntroduction).toHaveBeenCalledOnce();
    expect(repo.loadExperience).toHaveBeenCalledOnce();
    expect(repo.loadSkills).toHaveBeenCalledOnce();
    expect(repo.loadAwards).toHaveBeenCalledOnce();
    expect(repo.loadEducation).not.toHaveBeenCalled();
    expect(repo.loadProfile).not.toHaveBeenCalled();
    expect(repo.loadProjects).not.toHaveBeenCalled();
  });

  it.each(Object.keys(specs) as Key[])("preserves dirty %s draft across route-first Overview navigation", async key => {
    const spec = specs[key];
    const repo = repository(); show(repo, spec.path);
    expect(await screen.findByLabelText(spec.input)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(spec.input), { target: { value: spec.value } });
    navigate("Overview"); expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    navigate(spec.title); expect((await screen.findByLabelText(spec.input) as HTMLInputElement | HTMLTextAreaElement).value).toBe(spec.value);
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("loads Overview route-first without prefetching other sections", async () => {
    const repo = repository(); show(repo, "/overview");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(repo.loadOverview).toHaveBeenCalledOnce());
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    expect(repo.loadIntroduction).not.toHaveBeenCalled();
    expect(repo.loadExperience).not.toHaveBeenCalled();
    expect(repo.loadSkills).not.toHaveBeenCalled();
    expect(repo.loadAwards).not.toHaveBeenCalled();
  });

  it("invalidates the migrated section cache on sign-out and session change", async () => {
    const store = new ResumeSectionStore();
    const repo = repository();
    show(repo, "/skills", store);
    expect(await screen.findByLabelText("Chinese Group title")).toBeTruthy();
    expect(store.getSectionState("phase5a-session", resumeId, "skills").status).toBe("loaded");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(store.getSectionState("phase5a-session", resumeId, "skills").status).toBe("idle");

    store.setSession("phase5a-session");
    await store.loadSection("phase5a-session", resumeId, "awards", async () => structuredClone(fixtureSections.awards));
    store.setSession("new-session");
    expect(store.getSectionState("new-session", resumeId, "awards").status).toBe("idle");
    expect(store.getSectionState("phase5a-session", resumeId, "awards").status).toBe("idle");
  });
});
