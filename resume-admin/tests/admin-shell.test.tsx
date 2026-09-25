import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";

afterEach(() => { cleanup(); window.sessionStorage.clear(); });

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter>);
}

describe("Stage 4B fixture shell", () => {
  it("renders the isolated shell, every sidebar destination, and a visible fixture warning without a network request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderAt("/overview");
    for (const label of ["Overview", "Profile", "Introduction", "Education", "Experience", "Projects", "Skills", "Awards", "Contact", "Links & Site Text"]) {
      expect(screen.getByRole("navigation", { name: "CMS sections" }).querySelector(`a[href="/${label === "Links & Site Text" ? "links" : label.toLowerCase()}"]`)).not.toBeNull();
    }
    expect(screen.getByText(/No production data is being read or changed/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

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
