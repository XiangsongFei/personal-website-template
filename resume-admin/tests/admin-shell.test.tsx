import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
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
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(document.querySelectorAll(".item-card")).toHaveLength(3);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete New item" }));
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

  it("shows the two read-only Chinese fields and an accessible compact menu", () => {
    renderAt("/contact");
    expect((screen.getByLabelText("Chinese Availability") as HTMLTextAreaElement).readOnly).toBe(true);
    const menu = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });
});
