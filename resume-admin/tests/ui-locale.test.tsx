import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("localizes Profile production save controls and helper messages without changing resume values or writing", () => {
    const { repository } = renderProductionApp("/profile");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByText("共享信息：没有未保存修改")).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消修改" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存共享信息" })).toBeTruthy();
    expect(screen.getByText("中文个人资料将单独保存到生产环境。")).toBeTruthy();
    expect(screen.getByText("英文个人资料将单独保存到生产环境。")).toBeTruthy();
    expect((screen.getByLabelText("英文 姓名") as HTMLInputElement).value).toBe("Demo User");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText("Shared details: No unsaved changes")).toBeTruthy();
    expect(screen.getByText("Chinese profile translation saves to production separately.")).toBeTruthy();
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

  it("localizes Overview summaries and keeps English resume data intact", () => {
    renderProductionApp("/overview");
    expect(screen.getByText("The current example-cv resume is loaded. All resume content sections save to production.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Profile, Education, Introduction, Experience, Projects, Skills, Awards, Contact, and Links & Site Text save to production.");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByText("当前示例简历已加载。所有简历内容模块均可保存到生产环境。")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("个人资料、教育经历、个人简介、工作经历、项目、技能、荣誉奖项、联系信息、链接与网站文本均保存到生产环境。");
    expect(screen.getByText("简历")).toBeTruthy();
    expect(screen.getByText("中文 + 英文")).toBeTruthy();
    expect(screen.getByText("9 个编辑模块")).toBeTruthy();
    expect(screen.getByText("9 个可编辑模块")).toBeTruthy();
    expect(screen.getByText("打开一个模块以查看共享字段、中英文内容和有序条目。")).toBeTruthy();
    expect(screen.getByText("Demo User")).toBeTruthy();
  });

  it("localizes the production-write capability badge", () => {
    renderProductionApp("/overview");
    expect(screen.getByText("PRODUCTION WRITE")).toBeTruthy();
    expect(screen.getByText("Admin workspace · production write")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByText("支持生产写入")).toBeTruthy();
    expect(screen.getByText("管理员工作区 · 支持生产写入")).toBeTruthy();
  });

  it("keeps the authenticated topbar class used by the sticky header", () => {
    renderApp("/overview");
    expect(screen.getByRole("banner").className).toBe("topbar");
  });
});
