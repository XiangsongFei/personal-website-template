import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
  ["/profile", "Profile", "about", "Profile"], ["/introduction", "Introduction", "about", "Introduction"], ["/education", "Education", "education", "Education"],
  ["/experience", "Experience", "experience", "Experience"], ["/projects", "Projects", "projects", "Projects"], ["/skills", "Skills", "skills", "Skills"],
  ["/awards", "Awards", "awards", "Awards"], ["/contact", "Contact", "contact", "Contact"], ["/links", "Site & Links", "about", "Public links"],
] as const;
const modeKey = (section: PreviewSection) => `example-cv-cms:ui:preview-mode:${section}`;
const scrollKey = (path: string, mode: "editor" | "preview") => `example-cv-cms:ui:scroll:${path}:${mode}`;
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
function useWideDesktop() {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, media: "(min-width: 1440px)", addEventListener() {}, removeEventListener() {} }) });
}

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

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia); else Reflect.deleteProperty(window, "matchMedia"); });

describe("sidebar navigation and canonical preview workspace", () => {
  it("gives the common desktop route and workspace wrappers explicit full-width sizing", () => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    const desktopRules = css.match(/@media\(min-width:1440px\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const routeMainRule = desktopRules.match(/\.app-main\.has-preview-workspace>\.preview-route-main\{([^}]*)\}/)?.[1] ?? "";
    const workspaceRule = desktopRules.match(/\.preview-route-main>\.editor-preview-layout\{([^}]*)\}/)?.[1] ?? "";

    expect(routeMainRule).toContain("width:100%");
    expect(routeMainRule).toContain("min-width:0");
    expect(workspaceRule).toContain("width:100%");
    expect(workspaceRule).toContain("min-width:0");
    expect(workspaceRule).toContain("grid-template-columns:minmax(0,1fr) clamp(500px,calc(50vw - 155px),650px)");
  });

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

  it("uses independent desktop Editor and Preview scroll owners and can reach the Preview bottom", () => {
    useWideDesktop();
    renderApp("/education");
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    expect(editor.dataset.editorScrollMode).toBe("element");
    expect(preview.dataset.previewScrollMode).toBe("element");
    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 2100 });
    Object.defineProperty(preview, "clientHeight", { configurable: true, value: 600 });

    fireEvent.wheel(editor, { deltaY: 100 });
    editor.scrollTop = 240;
    fireEvent.scroll(editor);
    expect(window.sessionStorage.getItem(scrollKey("/education", "editor"))).toBe("240");
    expect(window.sessionStorage.getItem(scrollKey("/education", "preview"))).toBeNull();

    fireEvent.wheel(preview, { deltaY: 100 });
    preview.scrollTop = 1500;
    fireEvent.scroll(preview);
    expect(preview.scrollTop).toBe(preview.scrollHeight - preview.clientHeight);
    expect(window.sessionStorage.getItem(scrollKey("/education", "preview"))).toBe("1500");
    expect(editor.scrollTop).toBe(240);
    expect((document.scrollingElement ?? document.documentElement).scrollTop).toBe(0);
  });

  it("keeps the responsive stacked workspace on document scrolling", () => {
    renderApp("/education");
    expect(document.querySelector<HTMLElement>("[data-editor-scroll-owner]")?.dataset.editorScrollMode).toBe("document");
    expect((screen.getByTestId("resume-preview") as HTMLElement).dataset.previewScrollMode).toBe("document");
  });

  it("keeps desktop pane ownership after changing Admin routes", async () => {
    useWideDesktop();
    renderApp("/education");
    fireEvent.click(within(screen.getByRole("navigation", { name: "CMS sections" })).getByRole("link", { name: "Experience" }));
    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/experience"));
    expect(document.querySelector<HTMLElement>("[data-editor-scroll-owner]")?.dataset.editorScrollMode).toBe("element");
    expect((screen.getByTestId("resume-preview") as HTMLElement).dataset.previewScrollMode).toBe("element");
  });

  it.each(destinations)("renders %s inside the shared desktop Editor pane beside an independent Preview pane", (path, _title, _section, heading) => {
    useWideDesktop();
    window.sessionStorage.setItem(modeKey(path.slice(1) as PreviewSection), "preview");
    renderApp(path);

    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    const editor = layout.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    const routeContent = within(editor).getAllByRole("heading", { name: heading })[0];

    expect(editor.dataset.editorScrollMode).toBe("element");
    expect(preview.dataset.previewScrollMode).toBe("element");
    expect(editor.contains(routeContent)).toBe(true);
    expect(editor).not.toBe(preview);
    expect(editor.parentElement).toBe(layout);
    expect(preview.closest(".resume-preview-panel")?.parentElement).toBe(layout);
    expect(layout.querySelectorAll("[data-editor-scroll-owner]")).toHaveLength(1);
    expect(layout.querySelectorAll("[data-preview-scroll-owner]")).toHaveLength(1);
  });

  it("desktop Preview section navigation scrolls only the Preview pane with its sticky-row offset", () => {
    useWideDesktop();
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview") as HTMLElement;
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const target = viewport.querySelector("#preview-experience") as HTMLElement;
    const stickyNav = viewport.querySelector(".resume-preview-sticky-nav") as HTMLElement;
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 500 } as DOMRect);
    vi.spyOn(stickyNav, "getBoundingClientRect").mockReturnValue({ top: 100, height: 50 } as DOMRect);
    editor.scrollTop = 220;
    documentScrollOwner.scrollTop = 80;

    fireEvent.click(viewport.querySelector<HTMLAnchorElement>('a[href="#preview-experience"]')!);

    expect(viewport.scrollTop).toBe(350);
    expect(editor.scrollTop).toBe(220);
    expect(documentScrollOwner.scrollTop).toBe(80);
    expect(stickyNav.style.top).toBe("0px");
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
    const stickyNav = viewport.querySelector(".resume-preview-sticky-nav") as HTMLElement;
    const tabs = viewport.closest(".editor-preview-layout")?.querySelector(".editor-preview-toggle") as HTMLElement;
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ width: 500 } as DOMRect);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 420 } as DOMRect);
    vi.spyOn(tabs, "getBoundingClientRect").mockReturnValue({ height: 38 } as DOMRect);
    vi.spyOn(stickyNav, "getBoundingClientRect").mockReturnValue({ top: 110, height: 50 } as DOMRect);
    fireEvent.resize(window);
    documentScrollOwner.scrollTop = 760;

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(1024));
    expect(stickyNav.style.top).toBe("106px");
  });

  it.each(["about", "experience", "projects", "skills", "awards", "contact"])("keeps the clicked Preview %s section below the sticky navigation row", section => {
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview") as HTMLElement;
    const panel = viewport.closest(".resume-preview-panel") as HTMLElement;
    const target = viewport.querySelector(`#preview-${section}`) as HTMLElement;
    const stickyNav = viewport.querySelector(".resume-preview-sticky-nav") as HTMLElement;
    const tabs = viewport.closest(".editor-preview-layout")?.querySelector(".editor-preview-toggle") as HTMLElement;
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ width: 500 } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 520 } as DOMRect);
    vi.spyOn(tabs, "getBoundingClientRect").mockReturnValue({ height: 38 } as DOMRect);
    vi.spyOn(stickyNav, "getBoundingClientRect").mockReturnValue({ top: 110, height: 50 } as DOMRect);
    fireEvent.resize(window);
    documentScrollOwner.scrollTop = 300;

    const sectionLink = viewport.querySelector<HTMLAnchorElement>(`a[href="#preview-${section}"]`);
    expect(sectionLink).toBeTruthy();
    fireEvent.click(sectionLink!);

    expect(documentScrollOwner.scrollTop).toBe(664);
    expect(stickyNav.style.top).toBe("106px");
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
