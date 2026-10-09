import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import type { ResumeRepository } from "../src/data/resumeRepository";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.removeItem(UI_LOCALE_KEY); });

function renderAt(path: string, locale: "en" | "zh" = "en") {
  window.localStorage.setItem(UI_LOCALE_KEY, locale);
  return render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider>);
}

describe("Stage 4B fixture shell", () => {
  it("renders all existing sidebar destinations without a network request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderAt("/overview");
    const nav = screen.getByRole("navigation", { name: "CMS sections" });
    for (const path of ["/overview", "/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links"]) {
      expect(nav.querySelector(`a[href="${path}"]`)).not.toBeNull();
    }
    expect(screen.getByText("Resume Editor")).toBeTruthy();
    expect(nav.querySelector('a[href="/links"]')?.textContent).toBe("Site & Links");
    expect(screen.getByText("Choose a section to start editing.")).toBeTruthy();
    expect(screen.queryByText(/production environment|production data|Published|editable modules|Content completeness/i)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("exposes Version History separately from Activity Log and loads its own route", async () => {
    const repository = { loadVersionHistoryPage: vi.fn().mockResolvedValue({ entries: [], hasMore: false, nextCursor: null }) } as unknown as ResumeRepository;
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/version-history"]}><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" repository={repository} additionalResumeId="qa-resume"
      activityLogEnabled /></MemoryRouter></UiLocaleProvider>);
    const nav = screen.getByRole("navigation", { name: "CMS sections" });
    expect(nav.querySelector('a[href="/activity-log"]')?.textContent).toBe("Activity Log");
    expect(nav.querySelector('a[href="/version-history"]')?.textContent).toBe("Version History");
    expect(await screen.findByRole("heading", { level: 1, name: "Version History" })).toBeTruthy();
    expect(repository.loadVersionHistoryPage).toHaveBeenCalledWith("qa-resume", 25);
  });

  it("keeps grouped and ungrouped sidebar destinations on the same typography contract", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toMatch(/\.sidebar-link\{[^}]*font-size:15px;line-height:1\.3;font-weight:400/);
    expect(styles).not.toMatch(/\.sidebar-nav-group\s+\.sidebar-link\s*\{/);
    expect(styles).toMatch(/\.sidebar-link\.is-active\{[^}]*font-weight:600\}/);
    expect(styles).not.toMatch(/\.sidebar-link\.is-active\{[^}]*font-size:/);

    const repository = { loadVersionHistoryPage: vi.fn().mockResolvedValue({ entries: [], hasMore: false, nextCursor: null }) } as unknown as ResumeRepository;
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/links"]}><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" repository={repository} additionalResumeId="qa-resume"
      activityLogEnabled /></MemoryRouter></UiLocaleProvider>);
    const navigation = screen.getByRole("navigation", { name: "CMS sections" });
    for (const path of ["/overview", "/profile", "/links", "/activity-log", "/version-history"]) {
      expect(navigation.querySelector(`a[href="${path}"]`)?.classList.contains("sidebar-link")).toBe(true);
    }
    expect(navigation.querySelector('a[href="/links"]')?.classList.contains("is-active")).toBe(true);
    expect(navigation.querySelector('a[href="/overview"]')?.classList.contains("is-active")).toBe(false);
  });

  it.each([["en", "Resume Editor", "Home", "Resume", "Settings", "Site & Links"], ["zh", "简历编辑器", "首页", "简历内容", "设置", "网站与链接"]] as const)(
    "%s localizes brand and the resume-structure sidebar groups", (locale, brand, home, resume, settings, siteLinks) => {
      renderAt("/links", locale);
      expect(screen.getByText(brand)).toBeTruthy();
      const navigation = screen.getByRole("navigation", { name: locale === "zh" ? "CMS 模块" : "CMS sections" });
      expect(within(navigation).getByText(home)).toBeTruthy();
      expect(within(navigation).getByText(resume)).toBeTruthy();
      expect(within(navigation).getByText(settings)).toBeTruthy();
      const link = navigation.querySelector('a[href="/links"]');
      expect(link?.textContent).toBe(siteLinks);
      expect(link?.getAttribute("aria-current")).toBe("page");
    },
  );

  it.each([
    ["/overview", "Overview"], ["/profile", "Profile"], ["/introduction", "Introduction"],
    ["/education", "Education"], ["/experience", "Experience"], ["/projects", "Projects"],
    ["/skills", "Skills"], ["/awards", "Awards"], ["/contact", "Contact"],
    ["/links", "Links & Site Text"],
  ])("renders %s as the intended section", (path, title) => {
    renderAt(path);
    if (path === "/links") expect(screen.getByRole("heading", { name: "Public links" })).toBeTruthy();
    else expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
    const link = screen.getByRole("navigation", { name: "CMS sections" }).querySelector(`a[href="${path}"]`);
    expect(link?.getAttribute("aria-current")).toBe("page");
  });

  it("shows shared and paired bilingual profile fields", () => {
    renderAt("/profile");
    expect(screen.getByLabelText("Graduation value")).toBeTruthy();
    expect(screen.getByLabelText("Chinese Name")).toBeTruthy();
    expect(screen.getByLabelText("English Name")).toBeTruthy();
  });

  it("adds and removes a local education item", () => {
    renderAt("/education");
    expect(document.querySelectorAll(".item-card")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Add Education" }));
    expect(document.querySelectorAll(".item-card")).toHaveLength(3);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(document.querySelectorAll<HTMLElement>(".item-card")[2].querySelector<HTMLButtonElement>('button[aria-label="Delete Uncategorized"]')!);
    expect(document.querySelectorAll(".item-card")).toHaveLength(2);
  });

  it("moves awards in local order and reverts that order", () => {
    renderAt("/awards");
    const labels = () => Array.from(document.querySelectorAll(".item-card-heading h3"), item => item.textContent);
    expect(labels()).toEqual(["Example Project Outcome", "Example Academic Honour"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Example Academic Honour up" }));
    expect(labels()).toEqual(["Example Academic Honour", "Example Project Outcome"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(labels()).toEqual(["Example Project Outcome", "Example Academic Honour"]);
  });

  it.each([
    ["en", "Move up Chinese method 2", "Move down Chinese method 1", "Chinese methods 1"],
    ["zh", "上移中文方法 2", "下移中文方法 1", "中文方法 1"],
  ] as const)("localizes Projects method reorder names in %s without changing the reorder action", (locale, moveUp, moveDown, firstMethodLabel) => {
    renderAt("/projects", locale);
    const methodGroups = document.querySelectorAll(".projects-editor-scope .method-group");
    const chineseMethods = methodGroups[0];
    const values = () => Array.from(chineseMethods.querySelectorAll<HTMLInputElement>("input"), input => input.value);
    expect(values()).toEqual(["数据整理", "指标分析"]);
    expect(screen.getByRole("button", { name: moveUp })).toBeTruthy();
    expect(screen.getByRole("button", { name: moveDown })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: moveUp }));
    expect(values()).toEqual(["指标分析", "数据整理"]);
    expect(screen.getByLabelText(firstMethodLabel)).toBeTruthy();
  });

  it("marks edits dirty, reverts them, and saves fixture changes for this browser session", () => {
    const view = renderAt("/profile");
    const englishName = screen.getByLabelText("English Name") as HTMLInputElement;
    fireEvent.change(englishName, { target: { value: "Temporary Name" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Demo User");
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "Local Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Saved in this browser session only");
    view.unmount();
    renderAt("/profile");
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Local Name");
  });

  it("allows editing Chinese Availability and keeps the compact menu accessible", () => {
    renderAt("/contact");
    expect((screen.getByLabelText("Chinese Availability") as HTMLTextAreaElement).readOnly).toBe(false);
    expect((screen.getByLabelText("English Availability") as HTMLTextAreaElement).readOnly).toBe(false);
    const menu = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });
});
