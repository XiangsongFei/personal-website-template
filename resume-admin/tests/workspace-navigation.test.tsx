import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import type { LoadedResume } from "../src/data/resumeMapper";
import type { PreviewSection } from "../src/preview/ResumePreviewPanel";
import { UiLocaleProvider } from "../src/uiLocale";

const resume: LoadedResume = {
  resumeId: "workspace-navigation-resume", siteKey: "example-cv", isPublished: true, updatedAt: null,
  sections: structuredClone(fixtureSections),
};
const destinations = [
  ["/profile", "Profile", "about"], ["/introduction", "Introduction", "about"], ["/education", "Education", "education"],
  ["/experience", "Experience", "experience"], ["/projects", "Projects", "projects"], ["/skills", "Skills", "skills"],
  ["/awards", "Awards", "awards"], ["/contact", "Contact", "contact"], ["/links", "Site & Links", "about"],
] as const;
const modeKey = (section: PreviewSection) => `example-cv-cms:ui:preview-mode:${section}`;

function LocationProbe() { const location = useLocation(); return <output data-testid="current-route">{location.pathname}</output>; }
function RouteButtons() {
  const navigate = useNavigate();
  return <nav aria-label="History navigation test controls"><button type="button" onClick={() => navigate(-1)}>Back</button><button type="button" onClick={() => navigate(1)}>Forward</button>
    {destinations.map(([path]) => <button key={path} type="button" onClick={() => navigate(path)}>{path}</button>)}</nav>;
}

function renderApp(path: string, historyControls = false, initialEntries = [path]) {
  return render(<UiLocaleProvider><MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>{historyControls && <RouteButtons />}<LocationProbe /><App
    identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} /></MemoryRouter></UiLocaleProvider>);
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe("sidebar navigation and canonical preview workspace", () => {
  it.each([
    ["/experience", "/projects", "Projects"],
    ["/education", "/education", "Education"],
    ["/profile", "/experience", "Experience"],
  ] as const)("clicking a sidebar destination from %s Preview opens it in Editor mode", async (fromPath, targetPath, targetSection) => {
    const from = fromPath.slice(1) as PreviewSection;
    const target = targetPath.slice(1) as PreviewSection;
    window.sessionStorage.setItem(modeKey(from), "preview");
    window.sessionStorage.setItem(modeKey(target), "preview");
    renderApp(fromPath);
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(screen.getByRole("navigation", { name: "CMS sections" })).getByRole("link", { name: targetSection }));

    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe(targetPath));
    expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("false");
    expect(window.sessionStorage.getItem(modeKey(target))).toBe("editor");
  });

  it("forces Editor when the active sidebar route is clicked while already in Preview", async () => {
    window.sessionStorage.setItem(modeKey("experience"), "preview");
    renderApp("/experience");
    fireEvent.click(within(screen.getByRole("navigation", { name: "CMS sections" })).getByRole("link", { name: "Experience" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("current-route").textContent).toBe("/experience");
    expect(window.sessionStorage.getItem(modeKey("experience"))).toBe("editor");
  });

  it("starts every explicit sidebar destination in Editor mode", async () => {
    for (const [path] of destinations) window.sessionStorage.setItem(modeKey(path.slice(1) as PreviewSection), "preview");
    renderApp("/profile");
    const nav = within(screen.getByRole("navigation", { name: "CMS sections" }));
    for (const [path, label] of destinations) {
      fireEvent.click(nav.getByRole("link", { name: label }));
      await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe(path));
      expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true");
      expect(window.sessionStorage.getItem(modeKey(path.slice(1) as PreviewSection))).toBe("editor");
    }
  });

  it.each(destinations)("Preview from %s focuses its target in the same full resume document", async (path, label, focus) => {
    const section = path.slice(1) as PreviewSection;
    window.sessionStorage.setItem(modeKey(section), "editor");
    renderApp(path);
    const viewport = screen.getByTestId("resume-preview");
    const fullPageMarkup = viewport.querySelector(".resume-preview-page")?.innerHTML;
    expect(viewport.querySelector("#preview-about")).toBeTruthy();
    expect(viewport.querySelector("#preview-education")).toBeTruthy();
    expect(viewport.querySelector("#preview-experience")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(viewport.getAttribute("data-preview-focus")).toBe(focus);
    expect(viewport.querySelector(".resume-preview-page")?.innerHTML).toBe(fullPageMarkup);
    expect(viewport.querySelectorAll(".resume-preview-marked-text[data-preview-modified='true']")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "Demo User" })).toBeTruthy();
    expect(label).toBeTruthy();
  });

  it("re-focuses the current target on Editor to Preview entry after the preview was scrolled", async () => {
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview") as HTMLElement;
    const panel = viewport.closest(".resume-preview-panel") as HTMLElement;
    const target = viewport.querySelector("#preview-education") as HTMLElement;
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ width: 500 } as DOMRect);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 420 } as DOMRect);
    documentScrollOwner.scrollTop = 760;

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(1080));
  });

  it("uses modified highlighting only for changed Education values, not because Education is focused", () => {
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview");
    const education = viewport.querySelector("#preview-education") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(education.querySelector(".resume-preview-marked-text[data-preview-modified='true']")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    fireEvent.change(screen.getAllByLabelText("English Title")[0], { target: { value: "Changed education title" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const modified = Array.from(education.querySelectorAll<HTMLElement>(".resume-preview-marked-text[data-preview-modified='true']"));
    expect(modified).toHaveLength(1);
    expect(modified[0].textContent).toBe("Changed education title");
    expect(viewport.getAttribute("data-preview-focus")).toBe("education");
  });

  it("preserves the target route mode on browser Back and Forward", async () => {
    window.sessionStorage.setItem(modeKey("profile"), "preview");
    window.sessionStorage.setItem(modeKey("projects"), "editor");
    renderApp("/projects", true, ["/profile", "/projects"]);
    expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/profile"));
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/projects"));
    expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true");
  });
});
