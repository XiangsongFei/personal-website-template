import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { createResumeRepository, type ResumeRepository, type ResumeSectionRepository } from "../src/data/resumeRepository";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "overview-resume-id";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function auth(): AdminAuthClient {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  return { getIdentity: vi.fn().mockResolvedValue({ id: "admin", email: "admin@example.test", sessionKey: "overview-session" }),
    isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(async () => listener?.("SIGNED_OUT", null)),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }) };
}
function repository(overrides: Partial<ResumeSectionRepository> = {}) {
  return {
    load: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: "2026-09-25T00:00:00Z", sections: structuredClone(fixtureSections) }),
    loadSiteMetadata: vi.fn().mockResolvedValue({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: "2026-09-25T00:00:00Z" }),
    loadOverview: vi.fn().mockResolvedValue({ profileName: "Overview English Name" }),
    loadProfile: vi.fn().mockResolvedValue(structuredClone(fixtureSections.profile)),
    loadIntroduction: vi.fn().mockResolvedValue(fixtureSections.introduction),
    loadEducation: vi.fn().mockResolvedValue(fixtureSections.education),
    loadExperience: vi.fn().mockResolvedValue(fixtureSections.experience),
    loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects),
    loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards),
    loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(fixtureSections.links),
    updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    ...overrides,
  };
}
function show(repo: ResumeRepository, path = "/overview", store = new ResumeSectionStore(), strict = false) {
  const app = <UiLocaleProvider><MemoryRouter initialEntries={[path]}><AuthGate client={auth()} resumeRepository={repo} sectionStore={store} /></MemoryRouter></UiLocaleProvider>;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), store };
}
function navigate(path: string) { fireEvent.click(document.querySelector(`a[href="${path}"]`)!); }
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Phase 5E Overview route-first loading", () => {
  it("cold /overview reads only site metadata and profile translations, then preserves the existing Overview values", async () => {
    const reads: string[] = [];
    const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
      reads.push(table);
      if (table === "resume_sites") return { maybeSingle: async () => ({ data: { id: resumeId, site_key: "example-cv", is_published: false, updated_at: "2026-09-25T00:00:00Z" }, error: null }) };
      if (table === "resume_profile_translations") return Promise.resolve({ data: [
        { resume_id: resumeId, locale: "zh", name: "中文姓名" },
        { resume_id: resumeId, locale: "en", name: "Database English Name" },
      ], error: null });
      throw new Error(`Unexpected table read ${table}`);
    }) })), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const full = vi.spyOn(repo, "load");
    show(repo, "/overview", new ResumeSectionStore(), true);
    expect(await screen.findByText("Database English Name")).toBeTruthy();
    expect(reads).toEqual(["resume_sites", "resume_profile_translations"]);
    expect(full).not.toHaveBeenCalled();
    expect(screen.getByText("Current resume")).toBeTruthy();
    expect(screen.getByText("Content languages")).toBeTruthy();
    expect(screen.getByText("Last updated")).toBeTruthy();
    expect(screen.getByText("2026-09-25 08:00:00")).toBeTruthy();
    expect(screen.getByText("Beijing Time")).toBeTruthy();
    expect(screen.getByText("Chinese · English")).toBeTruthy();
    expect(screen.queryByText("Unpublished")).toBeNull();
    expect(screen.queryByText("9 editor sections")).toBeNull();
    expect(screen.queryByText("9 editable")).toBeNull();
    expect(screen.queryByText(/production environment|production data|Published|Content completeness|editable modules/i)).toBeNull();
    const destinations = ["/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links"];
    const management = screen.getByRole("navigation", { name: "Content management" });
    const managementLinks = Array.from(management.querySelectorAll("a"));
    expect(managementLinks.map(link => link.getAttribute("href"))).toEqual(destinations);
    expect(managementLinks.map(link => [link.querySelector("strong")?.textContent, link.querySelector("small")?.textContent])).toEqual([
      ["Profile", "Identity, photo, and shared information"], ["Introduction", "Homepage introduction"],
      ["Education", "Schools and education background"], ["Experience", "Internships and work experience"],
      ["Projects", "Projects and outcomes"], ["Skills", "Skill categories and content"], ["Awards", "Awards and honors"],
      ["Contact", "Contact information"], ["Site & Links", "Navigation, links, and site text"],
    ]);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    expect(reads.some(table => table !== "resume_sites" && table !== "resume_profile_translations")).toBe(false);
  });

  it("localizes the Overview and all sidebar group labels while keeping the resume identity dynamic", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const repo = repository({ loadOverview: vi.fn().mockResolvedValue({ profileName: "中文界面动态姓名" }) });
    show(repo);
    expect(await screen.findByText("中文界面动态姓名")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "概览" })).toBeTruthy();
    expect(screen.getByText("工作区概览")).toBeTruthy();
    expect(screen.getByText("管理并维护你的中英文简历内容。")).toBeTruthy();
    expect(screen.getByText("中文界面动态姓名")).toBeTruthy();
    expect(screen.getByText("中文 · English")).toBeTruthy();
    expect(screen.getByText("北京时间")).toBeTruthy();
    const sidebar = screen.getByRole("navigation", { name: "CMS 模块" });
    expect(within(sidebar).getByText("首页")).toBeTruthy();
    expect(within(sidebar).getByText("简历内容")).toBeTruthy();
    expect(within(sidebar).getByText("设置")).toBeTruthy();
    expect(within(sidebar).getByText("网站与链接")).toBeTruthy();
    const management = screen.getByRole("navigation", { name: "内容管理" });
    const managementLinks = Array.from(management.querySelectorAll("a"));
    expect(managementLinks.map(link => link.getAttribute("href"))).toEqual([
      "/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links",
    ]);
    expect(managementLinks.map(link => [link.querySelector("strong")?.textContent, link.querySelector("small")?.textContent])).toEqual([
      ["个人资料", "基本身份、头像与共享信息"], ["个人简介", "首页个人介绍"], ["教育经历", "学校与教育背景"],
      ["工作经历", "实习与工作经验"], ["项目经历", "项目与成果"], ["技能", "技能分类与内容"],
      ["荣誉奖项", "奖项与荣誉"], ["联系方式", "联系信息"], ["网站与链接", "导航、链接及网站文字"],
    ]);
    expect(screen.queryByText(/生产环境|生产数据|已发布|内容完整度|编辑模块/)).toBeNull();
  });

  it.each([
    ["en", "Loading Overview...", "Unable to load Overview.", "Retry"],
    ["zh", "正在加载概览……", "无法加载概览。", "重试"],
  ] as const)("shows %s loading/error and retries only Overview with the shell mounted", async (locale, loading, errorText, retry) => {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    const pending = deferred<{ profileName: string }>(); void pending.promise.catch(() => {});
    const repo = repository({ loadOverview: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ profileName: "Retried name" }) });
    show(repo);
    expect(await screen.findByRole("navigation", { name: locale === "en" ? "CMS sections" : "CMS 模块" })).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(loading);
    expect(screen.queryByRole("heading", { name: "Loading resume content…" })).toBeNull();
    pending.reject(new Error("Overview translation read failed"));
    expect((await screen.findByRole("alert")).textContent).toContain(errorText);
    fireEvent.click(screen.getByRole("button", { name: retry }));
    expect(await screen.findByText("Retried name")).toBeTruthy();
    expect(repo.loadOverview).toHaveBeenCalledTimes(2);
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    for (const method of ["loadProfile", "loadIntroduction", "loadEducation", "loadExperience", "loadProjects", "loadSkills", "loadAwards", "loadContact", "loadLinks"] as const) {
      expect(repo[method]).not.toHaveBeenCalled();
    }
  });

  it("coalesces StrictMode, reuses metadata from Profile, and keeps Profile and Overview caches independent", async () => {
    const store = new ResumeSectionStore(); const repo = repository();
    show(repo, "/profile", store, true);
    expect(await screen.findByLabelText("English Name")).toBeTruthy();
    expect(store.getSectionState("overview-session", resumeId, "profile").status).toBe("loaded");
    expect(store.getSectionState("overview-session", resumeId, "overview").status).toBe("idle");
    navigate("/overview");
    expect(await screen.findByText("Overview English Name")).toBeTruthy();
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    expect(store.getSectionState("overview-session", resumeId, "overview").status).toBe("loaded");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("heading", { name: "概览" })).toBeTruthy();
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(store.getSectionState("overview-session", resumeId, "profile").status).toBe("loaded");
    navigate("/profile");
    expect(await screen.findByLabelText("英文 姓名")).toBeTruthy();
    expect(repo.loadProfile).toHaveBeenCalledOnce();
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
  });

  it("loads Profile separately after Overview and reuses cached Overview without prefetch", async () => {
    const repo = repository(); const { store } = show(repo);
    expect(await screen.findByText("Overview English Name")).toBeTruthy();
    expect(store.getSectionState("overview-session", resumeId, "overview").status).toBe("loaded");
    expect(store.getSectionState("overview-session", resumeId, "profile").status).toBe("idle");
    navigate("/profile");
    expect(await screen.findByLabelText("English Name")).toBeTruthy();
    expect(repo.loadProfile).toHaveBeenCalledOnce();
    navigate("/overview");
    expect(await screen.findByText("Overview English Name")).toBeTruthy();
    expect(repo.loadOverview).toHaveBeenCalledOnce();
    expect(repo.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(repo.load).not.toHaveBeenCalled();
    for (const method of ["loadIntroduction", "loadEducation", "loadExperience", "loadProjects", "loadSkills", "loadAwards", "loadContact", "loadLinks"] as const) {
      expect(repo[method]).not.toHaveBeenCalled();
    }
  });

  it("isolates Overview failure and retry from already loaded Profile and Education caches", async () => {
    const pending = deferred<{ profileName: string }>(); void pending.promise.catch(() => {});
    const repo = repository({ loadOverview: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ profileName: "Recovered overview" }) });
    const store = new ResumeSectionStore(); store.setSession("overview-session");
    await store.loadSection("overview-session", resumeId, "profile", async () => structuredClone(fixtureSections.profile));
    await store.loadSection("overview-session", resumeId, "education", async () => structuredClone(fixtureSections.education));
    show(repo, "/overview", store);
    expect(await screen.findByRole("status")).toBeTruthy();
    pending.reject(new Error("temporary Overview failure"));
    await screen.findByRole("alert");
    expect(store.getSectionState("overview-session", resumeId, "profile").status).toBe("loaded");
    expect(store.getSectionState("overview-session", resumeId, "education").status).toBe("loaded");
    expect(store.getSectionState("overview-session", resumeId, "overview").status).toBe("error");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Recovered overview")).toBeTruthy();
    expect(repo.loadOverview).toHaveBeenCalledTimes(2);
    expect(repo.load).not.toHaveBeenCalled();
    expect(store.getSectionState("overview-session", resumeId, "profile").status).toBe("loaded");
    expect(store.getSectionState("overview-session", resumeId, "education").status).toBe("loaded");
  });

  it("invalidates Overview on sign-out and on a changed session", async () => {
    const store = new ResumeSectionStore(); const repo = repository(); show(repo, "/overview", store);
    expect(await screen.findByText("Overview English Name")).toBeTruthy();
    expect(store.getSectionState("overview-session", resumeId, "overview").status).toBe("loaded");
    store.setSession("next-overview-session");
    expect(store.getSectionState("overview-session", resumeId, "overview").status).toBe("idle");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(store.getSectionState("next-overview-session", resumeId, "overview").status).toBe("idle");
  });

  it.each([
    ["/overview", "loadOverview"], ["/profile", "loadProfile"], ["/introduction", "loadIntroduction"],
    ["/education", "loadEducation"], ["/experience", "loadExperience"], ["/projects", "loadProjects"],
    ["/skills", "loadSkills"], ["/awards", "loadAwards"], ["/contact", "loadContact"], ["/links", "loadLinks"],
  ] as const)("uses the route loader and never starts the full snapshot on %s", async (path, method) => {
    cleanup(); const repo = repository(); show(repo, path);
    await waitFor(() => expect(repo[method]).toHaveBeenCalled());
    expect(repo.load).not.toHaveBeenCalled();
  });
});
