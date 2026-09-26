import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import type { ResumeRepository } from "../src/data/resumeRepository";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

function renderApp(path = "/profile") {
  return render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}}
    signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider>);
}

function renderProductionApp(path = "/profile") {
  const repository = {
    load: vi.fn(), updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    updateEducationEntry: vi.fn(), updateEducationTranslation: vi.fn(),
    insertEducationEntry: vi.fn(), insertEducationTranslation: vi.fn(), readEducationTranslation: vi.fn(),
    deleteEducationEntry: vi.fn(),
  } as unknown as ResumeRepository;
  const resume = { resumeId: "test-resume", siteKey: "example-cv" as const, isPublished: true, updatedAt: null, sections: fixtureSections };
  const view = render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}}
    signOutPending={false} signOutError="" resume={resume} repository={repository} /></MemoryRouter></UiLocaleProvider>);
  return { ...view, repository };
}

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("global CMS UI locale", () => {
  it("defaults to English and switches the global navigation to Chinese", () => {
    renderApp("/overview");
    expect(screen.getAllByRole("link", { name: "Profile" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getAllByRole("link", { name: "个人资料" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "教育经历" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(UI_LOCALE_KEY)).toBe("zh");
  });

  it("groups the existing routes under the resume-structure navigation labels", () => {
    renderApp("/overview");
    const navigation = screen.getByRole("navigation", { name: "CMS sections" });
    expect(within(navigation).getByText("Home")).toBeTruthy();
    expect(within(navigation).getByText("Resume")).toBeTruthy();
    expect(within(navigation).getByText("Settings")).toBeTruthy();
    expect(within(navigation).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
      "/overview", "/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(within(navigation).getByText("首页")).toBeTruthy();
    expect(within(navigation).getByText("简历内容")).toBeTruthy();
    expect(within(navigation).getByText("设置")).toBeTruthy();
  });

  it("visually pairs Chinese and English inputs for the same semantic field", () => {
    renderApp("/profile");
    const nameHeading = screen.getByRole("heading", { level: 3, name: "Name" });
    const namePair = nameHeading.parentElement;
    expect(namePair).toBeTruthy();
    expect(within(namePair as HTMLElement).getByLabelText("Chinese Name")).toBeTruthy();
    expect(within(namePair as HTMLElement).getByLabelText("English Name")).toBeTruthy();
    expect(within(namePair as HTMLElement).getByText("中文", { selector: "span[aria-hidden='true']" })).toBeTruthy();
    expect(within(namePair as HTMLElement).getByText("EN", { selector: "span[aria-hidden='true']" })).toBeTruthy();
  });

  it("restores valid preference and falls back for invalid preference", () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const view = renderApp("/overview");
    expect(screen.getAllByRole("link", { name: "个人资料" }).length).toBeGreaterThan(0);
    view.unmount();
    window.localStorage.setItem(UI_LOCALE_KEY, "invalid");
    renderApp("/overview");
    expect(screen.getAllByRole("link", { name: "Profile" }).length).toBeGreaterThan(0);
  });

  it("keeps Profile resume values and unsaved drafts intact while switching UI language", () => {
    renderApp("/profile");
    const name = screen.getByLabelText("English Name") as HTMLInputElement;
    const original = name.value;
    fireEvent.change(name, { target: { value: "Draft English Name" } });
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect((screen.getByLabelText("英文 姓名") as HTMLInputElement).value).toBe("Draft English Name");
    expect((screen.getByLabelText("中文 姓名") as HTMLInputElement).value).not.toBe("Draft English Name");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Draft English Name");
    expect(original).not.toBe("Draft English Name");
  });

  it("provides a keyboard-accessible selected language control without triggering production work", () => {
    renderApp("/education");
    const chinese = screen.getByRole("button", { name: "中文" });
    expect(chinese.getAttribute("aria-pressed")).toBe("false");
    chinese.focus();
    expect(document.activeElement).toBe(chinese);
    fireEvent.keyDown(chinese, { key: "Enter" });
    fireEvent.click(chinese);
    expect(chinese.getAttribute("aria-pressed")).toBe("true");
  });

  it("localizes the unified Profile save action and section copy without changing resume values or writing", () => {
    const { repository } = renderProductionApp("/profile");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByText("共享信息")).toBeTruthy();
    expect(screen.getByText("个人资料内容")).toBeTruthy();
    expect(screen.queryByText("中文内容")).toBeNull();
    expect(screen.queryByText("英文内容")).toBeNull();
    expect(document.querySelector(".bilingual-column-headings [lang='zh']")?.textContent).toBe("中文");
    expect(document.querySelector(".bilingual-column-headings [lang='en']")?.textContent).toBe("English");
    expect(screen.getByText("没有未保存修改")).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消修改" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存个人资料修改" })).toBeTruthy();
    expect(screen.queryByText(/生产环境|数据库|API|分别保存/)).toBeNull();
    expect((screen.getByLabelText("英文 姓名") as HTMLInputElement).value).toBe("Demo User");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText("Shared information")).toBeTruthy();
    expect(screen.getByText("Profile content")).toBeTruthy();
    expect(screen.queryByText("Chinese content")).toBeNull();
    expect(screen.queryByText("English content")).toBeNull();
    expect(document.querySelector(".bilingual-column-headings [lang='zh']")?.textContent).toBe("Chinese");
    expect(document.querySelector(".bilingual-column-headings [lang='en']")?.textContent).toBe("English");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save profile changes" })).toBeTruthy();
    expect(screen.queryByText(/production environment|database|API|separately/i)).toBeNull();
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Demo User");
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
    expect(repository.updateProfileTranslation).not.toHaveBeenCalled();
  });

  it("localizes Education production controls and preserves its draft across locale switches without writes", () => {
    const { repository } = renderProductionApp("/education");
    fireEvent.change(screen.getByLabelText("English Title"), { target: { value: "Unchanged English resume title" } });
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("button", { name: "保存教育经历修改" })).toBeTruthy();
    expect(screen.getByText("教育经历需要明确保存，中文和英文彼此独立。")).toBeTruthy();
    expect((screen.getByLabelText("英文 标题") as HTMLInputElement).value).toBe("Unchanged English resume title");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("button", { name: "Save Education changes" })).toBeTruthy();
    expect((screen.getByLabelText("English Title") as HTMLInputElement).value).toBe("Unchanged English resume title");
    expect(repository.updateEducationEntry).not.toHaveBeenCalled();
    expect(repository.updateEducationTranslation).not.toHaveBeenCalled();
    expect(repository.insertEducationEntry).not.toHaveBeenCalled();
    expect(repository.deleteEducationEntry).not.toHaveBeenCalled();
  });

  it("localizes Overview content while keeping the dynamic resume identity", () => {
    renderProductionApp("/overview");
    expect(screen.getByText("Workspace Overview")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("Manage and maintain your bilingual resume content.")).toBeTruthy();
    expect(screen.getByText("Current resume")).toBeTruthy();
    expect(screen.getByText("Content languages")).toBeTruthy();
    expect(screen.getByText("Last updated")).toBeTruthy();
    expect(screen.getByText("Choose a section to start editing.")).toBeTruthy();
    expect(within(screen.getByLabelText("Resume summary")).getByText("Demo User")).toBeTruthy();
    expect(screen.queryByText(/production environment|production data|Published|editable modules|completeness/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByText("工作区概览")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "概览" })).toBeTruthy();
    expect(screen.getByText("管理并维护你的中英文简历内容。")).toBeTruthy();
    expect(screen.getByText("当前简历")).toBeTruthy();
    expect(screen.getByText("内容语言")).toBeTruthy();
    expect(screen.getByText("最后更新")).toBeTruthy();
    expect(screen.getByText("中文 · English")).toBeTruthy();
    expect(screen.getByText("选择一个部分开始编辑。")).toBeTruthy();
    expect(screen.queryByText(/生产环境|生产数据|已发布|内容完整度|编辑模块/)).toBeNull();
    expect(screen.getByRole("navigation", { name: "内容管理" }).querySelectorAll("a")).toHaveLength(9);
    expect(within(screen.getByLabelText("简历摘要")).getByText("示例用户")).toBeTruthy();
  });

  it("localizes the shell identity and removes repeated environment labels", () => {
    renderProductionApp("/overview");
    expect(screen.getAllByText("Resume Editor")).toHaveLength(1);
    const header = screen.getByRole("banner");
    expect(header.textContent).not.toContain("Example CV CMS");
    expect(header.textContent).not.toContain("PRODUCTION WRITE");
    expect(header.textContent).not.toContain("LOCAL DEMO");
    expect(header.textContent).toContain("admin@example.test");
    expect(document.querySelector(".sidebar-foot")).toBeNull();
    expect(document.querySelector(".topbar-badge")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getAllByText("简历编辑器")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "English" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
  });

  it("keeps the authenticated topbar class used by the sticky header", () => {
    renderApp("/overview");
    expect(screen.getByRole("banner").className).toBe("topbar");
  });
});
