import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const desktopEditorOnlyMedia = "(min-width: 861px) and (max-width: 1279px) and (pointer: fine)";
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
let mockViewportWidth = window.innerWidth;
let mockFinePointer = false;
const mediaListeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();
const restoreGeometry: Array<() => void> = [];
function mockScrollGeometry(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  const oldScrollHeight = Object.getOwnPropertyDescriptor(element, "scrollHeight");
  const oldClientHeight = Object.getOwnPropertyDescriptor(element, "clientHeight");
  Object.defineProperties(element, { scrollHeight: { configurable: true, value: scrollHeight }, clientHeight: { configurable: true, value: clientHeight } });
  restoreGeometry.push(() => {
    if (oldScrollHeight) Object.defineProperty(element, "scrollHeight", oldScrollHeight); else Reflect.deleteProperty(element, "scrollHeight");
    if (oldClientHeight) Object.defineProperty(element, "clientHeight", oldClientHeight); else Reflect.deleteProperty(element, "clientHeight");
  });
}
function matchesMedia(media: string) {
  return media === "(min-width: 1280px)" && mockViewportWidth >= 1280
    || media === desktopEditorOnlyMedia && mockFinePointer && mockViewportWidth >= 861 && mockViewportWidth <= 1279;
}
function setViewport(width: number, finePointer = false, dispatchTransition = false) {
  const previous = new Map([...mediaListeners.keys()].map(media => [media, matchesMedia(media)]));
  mockViewportWidth = width;
  mockFinePointer = finePointer;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (media: string) => ({
    get matches() { return matchesMedia(media); }, media, onchange: null,
    addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) { const listeners = mediaListeners.get(media) ?? new Set(); listeners.add(listener); mediaListeners.set(media, listeners); },
    removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) { mediaListeners.get(media)?.delete(listener); },
  }) });
  if (dispatchTransition) {
    fireEvent.resize(window);
    act(() => {
      for (const [media, listeners] of mediaListeners) {
        if (previous.get(media) === matchesMedia(media)) continue;
        const event = Object.assign(new Event("change"), { media, matches: matchesMedia(media) }) as MediaQueryListEvent;
        listeners.forEach(listener => listener(event));
      }
    });
  }
}
function useWideDesktop() { setViewport(1280); }

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

afterEach(() => { cleanup(); restoreGeometry.splice(0).forEach(restore => restore()); mediaListeners.clear(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia); else Reflect.deleteProperty(window, "matchMedia"); if (originalInnerWidth) Object.defineProperty(window, "innerWidth", originalInnerWidth); });

describe("sidebar navigation and canonical preview workspace", () => {
  it("gives the common desktop route and workspace wrappers explicit full-width sizing", () => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    const shellCss = readFileSync("src/styles.css", "utf8");
    const desktopRules = css.match(/@media\(min-width:1280px\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const routeMainRule = desktopRules.match(/\.app-main\.has-preview-workspace>\.preview-route-main\{([^}]*)\}/)?.[1] ?? "";
    const workspaceRule = desktopRules.match(/\.preview-route-main>\.editor-preview-layout\{([^}]*)\}/)?.[1] ?? "";

    expect(shellCss).toContain(".app-shell{grid-template-columns:190px minmax(0,1fr);background:#fff}");
    expect(shellCss).toContain("@media(max-width:860px){.app-shell{display:block}.sidebar{position:fixed;left:0;top:0;width:268px;");
    expect(routeMainRule).toContain("width:100%");
    expect(routeMainRule).toContain("min-width:0");
    expect(routeMainRule).toContain("padding:14px 16px 5px");
    expect(workspaceRule).toContain("width:100%");
    expect(workspaceRule).toContain("min-width:0");
    expect(workspaceRule).toContain("max-width:1390px");
    expect(workspaceRule).toContain("grid-template-columns:minmax(0,1fr) clamp(530px,calc(50vw - 125px),680px)");
  });

  it.each([1280, 1366, 1440, 2048])("transfers the released 30px from the desktop Sidebar to Preview at %ipx without changing the Editor track", width => {
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const oldLayout = Math.min(1360, width - 220 - 32);
    const newLayout = Math.min(1390, width - 190 - 32);
    const oldPreview = clamp(width / 2 - 155, 500, 650);
    const newPreview = clamp(width / 2 - 125, 530, 680);
    const oldEditor = oldLayout - oldPreview - 32;
    const newEditor = newLayout - newPreview - 32;

    expect(newLayout - oldLayout).toBe(30);
    expect(newPreview - oldPreview).toBe(30);
    expect(newEditor).toBe(oldEditor);
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

    const switcher = screen.getByRole("group", { name: "Workspace view" });
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    expect(editor.scrollTop).toBe(240);
    expect(preview.scrollTop).toBe(1500);
    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    expect(editor.scrollTop).toBe(240);
    expect(preview.scrollTop).toBe(1500);
  });

  it("switches Split → Preview → Split → Edit → Split without losing drafts, dirty state, or pane scroll positions", () => {
    setViewport(1440);
    window.sessionStorage.setItem(modeKey("profile"), "preview");
    renderApp("/profile");
    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    const editorPane = layout.querySelector<HTMLElement>(".editor-preview-pane")!;
    const editorScroll = editorPane.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    const previewPanel = preview.closest<HTMLElement>(".resume-preview-panel")!;
    const name = screen.getByLabelText("English Name") as HTMLInputElement;
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const editButton = within(switcher).getByRole("button", { name: "Edit" });
    const splitButton = within(switcher).getByRole("button", { name: "Split" });
    const previewButton = within(switcher).getByRole("button", { name: "Preview" });

    expect(document.querySelector(".sidebar")).not.toBeNull();
    expect(document.querySelector(".topbar")?.classList.contains("has-workspace-view-switcher")).toBe(true);
    expect(document.querySelector(".topbar-left .topbar-workspace-slot")?.firstElementChild).toBe(switcher);
    expect(document.querySelector(".topbar-left")?.contains(switcher)).toBe(true);
    expect(document.querySelector(".topbar .account-placeholder")).not.toBeNull();
    expect(layout.querySelector(".preview-workspace-switcher")).toBeNull();
    expect(within(switcher).queryByText("View")).toBeNull();
    expect(within(switcher).getAllByRole("button")).toHaveLength(3);
    expect(layout.dataset.workspaceView).toBe("split");
    expect(splitButton.getAttribute("aria-pressed")).toBe("true");
    expect([editButton, splitButton, previewButton].filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(editorPane.hidden).toBe(false);
    expect(previewPanel.hidden).toBe(false);
    expect(within(switcher).queryByRole("button", { name: "Expand Preview" })).toBeNull();
    fireEvent.change(name, { target: { value: "Unsaved focus-mode draft" } });
    editorScroll.scrollTop = 135;
    preview.scrollTop = 275;
    expect(editorPane.querySelector(".state-pill")?.textContent).toBe("Unsaved changes");

    fireEvent.click(previewButton);
    expect(layout.dataset.workspaceView).toBe("preview");
    expect(previewButton.getAttribute("aria-pressed")).toBe("true");
    expect([editButton, splitButton, previewButton].filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(editorPane.hidden).toBe(true);
    expect(editorPane.querySelector(".editor-action-footer")).not.toBeNull();
    expect(previewPanel.hidden).toBe(false);
    expect(screen.getByTestId("resume-preview")).toBe(preview);
    expect(editorScroll.scrollTop).toBe(135);
    expect(preview.scrollTop).toBe(275);
    expect(name.value).toBe("Unsaved focus-mode draft");
    expect(editorPane.querySelector(".state-pill")?.textContent).toBe("Unsaved changes");

    fireEvent.click(splitButton);
    expect(layout.dataset.workspaceView).toBe("split");
    expect(editorPane.hidden).toBe(false);
    expect(previewPanel.hidden).toBe(false);
    expect(splitButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(editButton);
    expect(layout.dataset.workspaceView).toBe("edit");
    expect(editButton.getAttribute("aria-pressed")).toBe("true");
    expect([editButton, splitButton, previewButton].filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(editorPane.hidden).toBe(false);
    expect(previewPanel.hidden).toBe(true);
    expect(editorScroll.scrollTop).toBe(135);
    expect(preview.scrollTop).toBe(275);
    expect(name.value).toBe("Unsaved focus-mode draft");
    expect(editorPane.querySelector(".state-pill")?.textContent).toBe("Unsaved changes");

    fireEvent.click(splitButton);
    expect(layout.dataset.workspaceView).toBe("split");
    expect(editorPane.hidden).toBe(false);
    expect(previewPanel.hidden).toBe(false);
    expect([editButton, splitButton, previewButton].filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(editorPane.querySelector("[data-editor-scroll-owner]")).toBe(editorScroll);
    expect(screen.getByTestId("resume-preview")).toBe(preview);
    expect(editorScroll.scrollTop).toBe(135);
    expect(preview.scrollTop).toBe(275);
    expect(name.value).toBe("Unsaved focus-mode draft");
    expect(editorPane.querySelector(".state-pill")?.textContent).toBe("Unsaved changes");
  });

  it("localizes all three workspace states through the existing Admin locale", () => {
    setViewport(1280);
    window.localStorage.setItem("cms-ui-locale", "zh");
    renderApp("/education");

    const switcher = screen.getByRole("group", { name: "工作区视图" });
    expect(document.querySelector(".topbar-left .topbar-workspace-slot")?.firstElementChild).toBe(switcher);
    expect(within(switcher).queryByText("视图")).toBeNull();
    expect(within(switcher).getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(within(switcher).getByRole("button", { name: "并排" })).toBeTruthy();
    expect(within(switcher).getByRole("button", { name: "预览" })).toBeTruthy();
  });

  it("keeps Split sizing and fixed Preview rendering unchanged while Edit/Preview use single-pane tracks", () => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    const shellCss = readFileSync("src/styles.css", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    const panel = readFileSync("src/preview/ResumePreviewPanel.tsx", "utf8");
    const desktopRules = css.match(/@media\(min-width:1280px\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const normalRule = desktopRules.match(/\.preview-route-main>\.editor-preview-layout\{([^}]*)\}/)?.[1] ?? "";
    const editRule = desktopRules.match(/\.preview-route-main>\.editor-preview-layout\[data-workspace-view=edit\]\{([^}]*)\}/)?.[1] ?? "";
    const previewRule = desktopRules.match(/\.preview-route-main>\.editor-preview-layout\[data-workspace-view=preview\]\{([^}]*)\}/)?.[1] ?? "";
    const previewStageRule = desktopRules.match(/\.editor-preview-layout\[data-workspace-view=preview\] \.resume-preview-stage\{([^}]*)\}/)?.[1] ?? "";
    const topbarRule = desktopRules.match(/\.topbar\.has-workspace-view-switcher\{([^}]*)\}/)?.[1] ?? "";
    const topbarLeftRule = desktopRules.match(/\.topbar\.has-workspace-view-switcher \.topbar-left\{([^}]*)\}/)?.[1] ?? "";
    const accountRule = desktopRules.match(/\.topbar\.has-workspace-view-switcher \.account-placeholder\{([^}]*)\}/)?.[1] ?? "";
    const switcherRule = desktopRules.match(/\.preview-workspace-switcher\{([^}]*)\}/)?.[1] ?? "";
    const workspaceSlotRule = desktopRules.match(/\.topbar-workspace-slot\{([^}]*)\}/)?.[1] ?? "";

    expect(normalRule).toContain('grid-template-columns:minmax(0,1fr) clamp(530px,calc(50vw - 125px),680px)');
    expect(normalRule).toContain("max-width:1390px");
    expect(css).toContain("gap:32px");
    expect(editRule).toContain("max-width:none");
    expect(editRule).toContain('grid-template-areas:"editor"');
    expect(previewRule).toContain("max-width:none");
    expect(previewRule).toContain('grid-template-areas:"preview"');
    expect(previewStageRule).toContain("width:min(100%,980px)");
    expect(panel).toContain("const PUBLIC_PAGE_WIDTH = 980");
    expect(panel).toContain("Math.min(1, viewport.clientWidth / PUBLIC_PAGE_WIDTH)");
    expect(app).toContain('className="preview-workspace-switcher"');
    expect(app).toContain("createPortal(");
    expect(topbarRule).toContain("justify-content:space-between");
    expect(topbarRule).not.toContain("display:grid");
    expect(topbarLeftRule).toContain("flex:0 0 auto");
    expect(accountRule).toContain("flex:0 0 auto");
    expect(shellCss).toContain(".topbar{height:70px;padding:0 clamp(20px,3vw,46px)");
    expect(workspaceSlotRule).not.toContain("padding-left");
    expect(desktopRules).not.toContain(".topbar-workspace-slot::before");
    expect(switcherRule).toContain("gap:22px");
    expect(switcherRule).not.toContain("justify-content:center");
    expect(app).toContain('data-workspace-view={wideDesktop ? workspaceView : undefined}');
    expect(css).toContain(".editor-action-footer{min-width:0;padding:8px 0 6px;background:#fff;gap:10px}");
    expect(css).toContain(".resume-preview-viewport{height:100%;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}");

    for (const width of [1279, 860, 640]) {
      cleanup();
      window.localStorage.clear();
      setViewport(width);
      renderApp("/education");
      expect(screen.queryByRole("group", { name: "Workspace view" })).toBeNull();
      expect(document.querySelector(".editor-preview-layout[data-workspace-view]")).toBeNull();
      expect(screen.getByTestId("resume-preview").getAttribute("data-preview-scroll-mode")).toBe("document");
    }
  });

  it.each([861, 1279])("hosts only Edit and Preview in the Header at %ipx fine-pointer desktop", width => {
    setViewport(width, true);
    renderApp("/education");

    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const layout = document.querySelector<HTMLElement>('.editor-preview-layout[data-preview-view="editor"]')!;
    const css = readFileSync("src/preview/preview.css", "utf8");
    const fineDesktopRules = css.match(/@media\(min-width:861px\) and \(max-width:1279px\) and \(pointer:fine\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const editorLayoutRule = fineDesktopRules.match(/\.app-main\.has-preview-workspace\.is-editor-only-desktop \.editor-preview-layout\[data-preview-view=editor\]\{([^}]*)\}/)?.[1] ?? "";
    const editorPaneRule = fineDesktopRules.match(/\.app-main\.has-preview-workspace\.is-editor-only-desktop \.editor-preview-layout\[data-preview-view=editor\] \.editor-preview-pane\{([^}]*)\}/)?.[1] ?? "";

    expect(document.querySelector(".topbar")?.classList.contains("has-workspace-view-switcher")).toBe(true);
    expect(document.querySelector(".topbar-left .topbar-workspace-slot")?.firstElementChild).toBe(switcher);
    expect(within(switcher).getAllByRole("button").map(button => button.textContent)).toEqual(["Edit", "Preview"]);
    expect(within(switcher).queryByRole("button", { name: "Split" })).toBeNull();
    expect(layout.querySelector(".editor-preview-toggle")).toBeNull();
    expect(layout.dataset.previewView).toBe("editor");
    expect(editorLayoutRule).toContain("grid-template-rows:minmax(0,1fr)");
    expect(editorLayoutRule).not.toContain("grid-template-rows:auto");
    expect(editorPaneRule).toContain("grid-row:1");
  });

  it("keeps all three Header workspace states at exactly 1280px", () => {
    setViewport(1280, true);
    renderApp("/education");
    const switcher = screen.getByRole("group", { name: "Workspace view" });

    expect(document.querySelector(".topbar-left .topbar-workspace-slot")?.firstElementChild).toBe(switcher);
    expect(within(switcher).getAllByRole("button").map(button => button.textContent)).toEqual(["Edit", "Split", "Preview"]);
    expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split");
  });

  it("keeps the existing mobile/touch workspace control inside the workspace at 860px", () => {
    setViewport(860, false);
    renderApp("/education");
    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    const legacyToggle = layout.querySelector<HTMLElement>(".editor-preview-toggle");

    expect(document.querySelector(".topbar-workspace-slot")).toBeNull();
    expect(screen.queryByRole("group", { name: "Workspace view" })).toBeNull();
    expect(legacyToggle).not.toBeNull();
    expect(legacyToggle?.parentElement).toBe(layout);
    expect(layout.querySelector("[data-workspace-view]")).toBeNull();
  });

  it("switches the intermediate desktop Header control without losing drafts, dirty state, or Editor scroll", async () => {
    setViewport(1024, true);
    renderApp("/profile");
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    const name = screen.getByLabelText("English Name") as HTMLInputElement;

    fireEvent.change(name, { target: { value: "Intermediate desktop draft" } });
    editor.scrollTop = 240;
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    expect(name.value).toBe("Intermediate desktop draft");
    expect(document.querySelector(".editor-action-footer .state-pill")?.textContent).toBe("Unsaved changes");

    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor"));
    expect(editor.scrollTop).toBe(240);
    expect(name.value).toBe("Intermediate desktop draft");
    expect(document.querySelector(".editor-action-footer .state-pill")?.textContent).toBe("Unsaved changes");
  });

  it("preserves document Preview scroll when switching modes in the intermediate desktop Header", async () => {
    setViewport(1024, true);
    renderApp("/education");
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;

    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    documentScrollOwner.scrollTop = 410;
    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor"));
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));

    expect(documentScrollOwner.scrollTop).toBe(410);
    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-scroll-mode")).toBe("document");
  });

  it("uses the localized Edit label for the intermediate desktop Header control", () => {
    setViewport(1024, true);
    window.localStorage.setItem("cms-ui-locale", "zh");
    renderApp("/education");
    const switcher = screen.getByRole("group", { name: "工作区视图" });

    expect(within(switcher).getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(within(switcher).getByRole("button", { name: "预览" })).toBeTruthy();
    expect(within(switcher).queryByRole("button", { name: "编辑器" })).toBeNull();
  });

  it.each([
    ["edit", "editor", "editor"],
    ["preview", "preview", "preview"],
  ] as const)("hands wide %s mode to the matching two-state mode at 1279px", async (wideMode, expectedMode, expectedPressed) => {
    setViewport(1280, true);
    renderApp("/education");
    const wideSwitcher = screen.getByRole("group", { name: "Workspace view" });
    fireEvent.click(within(wideSwitcher).getByRole("button", { name: wideMode === "edit" ? "Edit" : "Preview" }));
    setViewport(1279, true, true);

    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe(expectedMode));
    const narrowSwitcher = screen.getByRole("group", { name: "Workspace view" });
    expect(within(narrowSwitcher).getAllByRole("button").map(button => button.textContent)).toEqual(["Edit", "Preview"]);
    expect(within(narrowSwitcher).getByRole("button", { name: expectedPressed === "editor" ? "Edit" : "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(narrowSwitcher).queryByRole("button", { name: "Split" })).toBeNull();
    expect(within(narrowSwitcher).getAllByRole("button").filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("uses the saved two-state mode when wide Split collapses, and returns to wide Split", async () => {
    window.sessionStorage.setItem(modeKey("education"), "preview");
    setViewport(1280, true);
    renderApp("/education");
    expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split");
    setViewport(1279, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    setViewport(1280, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split"));
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    expect(within(switcher).getAllByRole("button").map(button => button.textContent)).toEqual(["Edit", "Split", "Preview"]);
    expect(within(switcher).getAllByRole("button").filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("uses Editor as the deterministic fallback when Split collapses without a saved two-state mode", async () => {
    setViewport(1280, true);
    renderApp("/education");
    setViewport(1279, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor"));
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    expect(within(switcher).getAllByRole("button").filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(within(switcher).getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("preserves dirty drafts while handing the workspace across 1280/1279 and back", async () => {
    setViewport(1280, true);
    renderApp("/profile");
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "Breakpoint draft" } });
    setViewport(1279, true, true);
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Workspace view" })).getAllByRole("button")).toHaveLength(2));
    setViewport(1280, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split"));
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Breakpoint draft");
    expect(document.querySelector(".editor-action-footer .state-pill")?.textContent).toBe("Unsaved changes");
    expect(screen.getByRole("button", { name: "Cancel changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy();
  });

  it("hands Preview position proportionally between its pane and document across 1280/1279", async () => {
    setViewport(1280, true);
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview") as HTMLElement;
    const documentOwner = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    mockScrollGeometry(viewport, 1600, 600);
    mockScrollGeometry(documentOwner, 3000, 720);
    fireEvent.click(within(screen.getByRole("group", { name: "Workspace view" })).getByRole("button", { name: "Preview" }));
    viewport.scrollTop = 250;

    setViewport(1279, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    expect(documentOwner.scrollTop).toBe(570);
    setViewport(1280, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split"));
    expect(viewport.scrollTop).toBe(250);
  });

  it("hands Editor position proportionally between its pane and document across 861/860", async () => {
    setViewport(861, true);
    renderApp("/profile");
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    const documentOwner = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    mockScrollGeometry(editor, 1500, 500);
    mockScrollGeometry(documentOwner, 2720, 720);
    editor.scrollTop = 400;

    setViewport(860, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-pane")?.getAttribute("data-editor-scroll-mode")).toBe("document"));
    expect(documentOwner.scrollTop).toBe(800);
    setViewport(861, true, true);
    await waitFor(() => expect(document.querySelector(".editor-content-scroll[data-editor-scroll-owner]")).not.toBeNull());
    expect(editor.scrollTop).toBe(400);
  });

  it("preserves a dirty draft across 861/860 and back without duplicate controls", async () => {
    setViewport(861, true);
    renderApp("/profile");
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "Narrow breakpoint draft" } });
    setViewport(860, true, true);
    await waitFor(() => expect(screen.getByRole("group", { name: "Editor or preview view" })).toBeTruthy());
    expect(screen.queryByRole("group", { name: "Workspace view" })).toBeNull();
    setViewport(861, true, true);
    await waitFor(() => expect(screen.getByRole("group", { name: "Workspace view" })).toBeTruthy());
    expect(screen.queryByRole("group", { name: "Editor or preview view" })).toBeNull();
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe("Narrow breakpoint draft");
    expect(document.querySelector(".editor-action-footer .state-pill")?.textContent).toBe("Unsaved changes");
    expect(screen.getByRole("button", { name: "Cancel changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy();
  });

  it("moves the legacy workspace toggle into and out of the Preview sticky offset at 860/861", async () => {
    setViewport(860, true);
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview") as HTMLElement;
    const stickyNav = viewport.querySelector(".resume-preview-sticky-nav") as HTMLElement;
    const toggle = document.querySelector<HTMLElement>(".editor-preview-toggle")!;
    vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue({ height: 38 } as DOMRect);
    fireEvent.resize(window);
    expect(stickyNav.style.top).toBe("106px");

    setViewport(861, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-toggle")).toBeNull());
    expect(stickyNav.style.top).toBe("68px");

    setViewport(860, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-toggle")).not.toBeNull());
    const reinsertedToggle = document.querySelector<HTMLElement>(".editor-preview-toggle")!;
    vi.spyOn(reinsertedToggle, "getBoundingClientRect").mockReturnValue({ height: 38 } as DOMRect);
    fireEvent.resize(window);
    expect(stickyNav.style.top).toBe("106px");
  });

  it("keeps the responsive stacked workspace on document scrolling", () => {
    renderApp("/education");
    expect(document.querySelector<HTMLElement>("[data-editor-scroll-owner]")?.dataset.editorScrollMode).toBe("document");
    expect((screen.getByTestId("resume-preview") as HTMLElement).dataset.previewScrollMode).toBe("document");
  });

  it("restores independent Editor and Preview document positions when switching modes on one route", () => {
    renderApp("/experience");
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    documentScrollOwner.scrollTop = 420;

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    documentScrollOwner.scrollTop = 910;
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(documentScrollOwner.scrollTop).toBe(420);

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(documentScrollOwner.scrollTop).toBe(910);
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(documentScrollOwner.scrollTop).toBe(420);
  });

  it("starts a newly entered and revisited sidebar Editor route at the top without carrying the old route position", async () => {
    renderApp("/experience");
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    const nav = within(screen.getByRole("navigation", { name: "CMS sections" }));
    documentScrollOwner.scrollTop = 1200;

    fireEvent.click(nav.getByRole("link", { name: "Projects" }));
    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/projects"));
    expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true");
    expect(documentScrollOwner.scrollTop).toBe(0);

    documentScrollOwner.scrollTop = 760;
    fireEvent.click(nav.getByRole("link", { name: "Experience" }));
    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/experience"));
    expect(documentScrollOwner.scrollTop).toBe(0);
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
    const pane = layout.querySelector<HTMLElement>(".editor-preview-pane")!;
    const routeFrame = editor.closest<HTMLElement>(".editor-workspace-route");
    const footer = routeFrame?.querySelector<HTMLElement>(".editor-action-footer");
    const saveNotice = footer?.querySelector<HTMLElement>(".save-notice");

    expect(editor.dataset.editorScrollMode).toBe("element");
    expect(preview.dataset.previewScrollMode).toBe("element");
    expect(editor.classList.contains("editor-content-scroll")).toBe(true);
    expect(editor.contains(routeContent)).toBe(true);
    expect(routeFrame).not.toBeNull();
    expect(routeFrame?.firstElementChild).toBe(editor);
    expect(routeFrame?.lastElementChild).toBe(footer);
    expect(footer?.querySelector(".save-bar")).not.toBeNull();
    expect(footer?.querySelector(".save-actions .button.secondary")).not.toBeNull();
    expect(footer?.querySelector(".save-actions .button.primary")).not.toBeNull();
    expect(!saveNotice || footer?.contains(saveNotice)).toBe(true);
    expect(editor).not.toBe(preview);
    expect(editor.parentElement).toBe(routeFrame);
    expect(routeFrame && pane.contains(routeFrame)).toBe(true);
    expect(pane.hasAttribute("data-editor-scroll-owner")).toBe(false);
    expect(preview.closest(".resume-preview-panel")?.parentElement).toBe(layout);
    expect(layout.querySelectorAll("[data-editor-scroll-owner]")).toHaveLength(1);
    expect(layout.querySelectorAll("[data-preview-scroll-owner]")).toHaveLength(1);
  });

  it("keeps the desktop Editor content viewport and action footer as separate workspace rows", () => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    const desktopRules = css.match(/@media\(min-width:1280px\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const paneRule = desktopRules.match(/\.editor-preview-pane\{([^}]*)\}/)?.[1] ?? "";
    const frameRule = desktopRules.match(/\.editor-workspace-route\{([^}]*)\}/)?.[1] ?? "";
    const contentRule = desktopRules.match(/\.editor-content-scroll\{([^}]*)\}/)?.[1] ?? "";
    const footerRule = desktopRules.match(/\.editor-action-footer\{([^}]*)\}/)?.[1] ?? "";
    const saveBarRule = desktopRules.match(/\.editor-action-footer \.save-bar\{([^}]*)\}/)?.[1] ?? "";

    expect(paneRule).toContain("overflow:hidden");
    expect(frameRule).toContain("grid-template-rows:minmax(0,1fr) auto");
    expect(frameRule).toContain("height:100%");
    expect(contentRule).toContain("overflow-y:auto");
    expect(contentRule).toContain("overscroll-behavior:contain");
    expect(footerRule).toContain("padding:8px 0 6px");
    expect(footerRule).toContain("background:#fff");
    expect(saveBarRule).toContain("position:static");
    expect(saveBarRule).toContain("margin-top:0");
    expect(saveBarRule).toContain("padding:0");
    expect(css).toContain(".editor-form-content{display:contents}");
    expect(css).toContain(".editor-preview-pane>:first-child{height:100%;min-height:0}");
    expect(css).toContain(".editor-workspace-route.editor-form{gap:0}");
    expect(css).toContain(".links-editor-scope .editor-form-content{gap:0}");
    expect(css).toContain(".links-editor-scope .editor-action-footer .save-bar{margin-top:0;padding:0}");
    expect(css).not.toContain(".editor-bottom-actions{position:sticky");
  });

  it.each([2048, 1440, 1366, 1280])("uses the same independent Editor/footer/Preview shell at %ipx across editor routes", width => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    expect(css).toContain("@media(min-width:1280px){");
    expect(css).toContain("@media(max-width:1279px){");
    expect(readFileSync("src/App.tsx", "utf8")).toContain('useMediaQuery("(min-width: 1280px)")');

    const routes = destinations.filter(([path]) => ["/profile", "/education", "/experience", "/projects", "/skills", "/awards", "/links"].includes(path));
    for (const route of routes) {
      const path = route[0];
      const heading = route[3];
      cleanup();
      setViewport(width);
      renderApp(path);
      const pane = document.querySelector<HTMLElement>(".editor-preview-pane")!;
      const content = pane.querySelector<HTMLElement>(".editor-content-scroll")!;
      const frame = pane.querySelector<HTMLElement>(".editor-workspace-route")!;
      const footer = frame.querySelector<HTMLElement>(".editor-action-footer")!;
      const preview = screen.getByTestId("resume-preview") as HTMLElement;

      expect(content.querySelector(`h1, h2, h3`)).toBeTruthy();
      expect(within(content).getAllByRole("heading", { name: heading })[0]).toBeTruthy();
      expect(frame.firstElementChild).toBe(content);
      expect(frame.lastElementChild).toBe(footer);
      expect(footer.querySelector(".save-bar .state-pill")).not.toBeNull();
      expect(footer.querySelector(".save-actions .button.secondary")).not.toBeNull();
      expect(footer.querySelector(".save-actions .button.primary")).not.toBeNull();
      expect(preview).not.toBe(content);

      expect(pane.dataset.editorScrollMode).toBeUndefined();
      expect(pane.hasAttribute("data-editor-scroll-owner")).toBe(false);
      expect(content.dataset.editorScrollMode).toBe("element");
      expect(preview.dataset.previewScrollMode).toBe("element");
    }
  });

  it("keeps all tested routes on document scrolling immediately below the 1280px desktop boundary", () => {
    setViewport(1279);
    const routes = destinations.filter(route => ["/profile", "/education", "/experience", "/projects", "/skills", "/awards", "/links"].includes(route[0]));
    for (const route of routes) {
      const path = route[0];
      cleanup();
      renderApp(path);
      const pane = document.querySelector<HTMLElement>(".editor-preview-pane")!;
      const content = pane.querySelector<HTMLElement>(".editor-content-scroll")!;
      const preview = screen.getByTestId("resume-preview") as HTMLElement;
      expect(pane.dataset.editorScrollMode).toBe("document");
      expect(pane.hasAttribute("data-editor-scroll-owner")).toBe(true);
      expect(content.hasAttribute("data-editor-scroll-owner")).toBe(false);
      expect(preview.dataset.previewScrollMode).toBe("document");
    }
  });

  it("uses the bottom-footer Editor shell for fine-pointer Editor-only desktops without changing the side-by-side or stacked modes", async () => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    const editorOnlyRules = css.match(/@media\(min-width:861px\) and \(max-width:1279px\) and \(pointer:fine\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const routeMainRule = editorOnlyRules.match(/\.app-main\.has-preview-workspace\.is-editor-only-desktop>\.preview-route-main\{([^}]*)\}/)?.[1] ?? "";
    expect(editorOnlyRules).toBeTruthy();
    expect(routeMainRule).toContain("padding:18px 16px 5px");
    expect(readFileSync("src/App.tsx", "utf8")).toContain(desktopEditorOnlyMedia);
    const routes = destinations.map(([path, , , heading]) => [path, heading] as const);

    for (const [path, heading] of routes) {
      cleanup();
      window.sessionStorage.clear();
      setViewport(1024, true);
      renderApp(path);
      const shell = document.querySelector<HTMLElement>(".app-shell.is-editor-only-desktop");
      const layout = document.querySelector<HTMLElement>('.editor-preview-layout[data-preview-view="editor"]')!;
      const pane = layout.querySelector<HTMLElement>(".editor-preview-pane")!;
      const frame = pane.querySelector<HTMLElement>(".editor-workspace-route")!;
      const content = frame.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
      const footer = frame.querySelector<HTMLElement>(".editor-action-footer")!;
      const preview = screen.getByTestId("resume-preview") as HTMLElement;

      expect(shell).not.toBeNull();
      expect(within(content).getAllByRole("heading", { name: heading })[0]).toBeTruthy();
      expect(frame.firstElementChild).toBe(content);
      expect(frame.lastElementChild).toBe(footer);
      expect(footer.querySelector(".save-bar .state-pill")).not.toBeNull();
      expect(footer.querySelector(".save-actions .button.secondary")).not.toBeNull();
      expect(footer.querySelector(".save-actions .button.primary")).not.toBeNull();
      expect(preview.dataset.previewScrollMode).toBe("document");
    }
  });

  it("preserves the Editor-only desktop content offset when switching Editor to Preview and back", async () => {
    setViewport(1024, true);
    renderApp("/education");
    const content = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    content.scrollTop = 240;
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(content.scrollTop).toBe(240));
  });

  it("keeps the stacked Editor on document scrolling without an inner Editor scroll owner", () => {
    renderApp("/profile");
    const pane = document.querySelector<HTMLElement>(".editor-preview-pane")!;
    expect(pane.dataset.editorScrollMode).toBe("document");
    expect(pane.hasAttribute("data-editor-scroll-owner")).toBe(true);
    expect(pane.querySelector(".editor-content-scroll")?.hasAttribute("data-editor-scroll-owner")).toBe(false);
  });

  it("switches the workspace scroll model at the 1280px side-by-side breakpoint", () => {
    useWideDesktop();
    renderApp("/profile");
    const desktopPane = document.querySelector<HTMLElement>(".editor-preview-pane")!;
    expect(desktopPane.dataset.editorScrollMode).toBeUndefined();
    expect(document.querySelector(".editor-content-scroll[data-editor-scroll-owner]")).not.toBeNull();
    cleanup();

    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, media: "(min-width: 1280px)", addEventListener() {}, removeEventListener() {} }) });
    renderApp("/profile");
    const stackedPane = document.querySelector<HTMLElement>(".editor-preview-pane")!;
    expect(stackedPane.dataset.editorScrollMode).toBe("document");
    expect(stackedPane.hasAttribute("data-editor-scroll-owner")).toBe(true);
    expect(stackedPane.querySelector(".editor-content-scroll")?.hasAttribute("data-editor-scroll-owner")).toBe(false);
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
