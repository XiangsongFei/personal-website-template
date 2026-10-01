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
const workspaceViewKey = (section: PreviewSection) => `example-cv-cms:ui:workspace-view:${section}`;
const scrollKey = (path: string, mode: "editor" | "preview") => `example-cv-cms:ui:scroll:${path}:${mode}`;
const desktopEditorOnlyMedia = "(min-width: 861px) and (max-width: 1279px) and (pointer: fine)";
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
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
function mockPreviewGeometry(viewport: HTMLElement, scale: number, scrollHeight: number, clientHeight: number, width = 0) {
  viewport.dataset.previewScale = String(scale);
  const oldWidth = Object.getOwnPropertyDescriptor(viewport, "clientWidth");
  Object.defineProperty(viewport, "clientWidth", { configurable: true, value: width });
  mockScrollGeometry(viewport, scrollHeight, clientHeight);
  const stage = viewport.querySelector<HTMLElement>(".resume-preview-stage")!;
  stage.style.height = `${Math.max(1, scrollHeight)}px`;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ width, height: Math.max(1, scrollHeight), top: 0, bottom: Math.max(1, scrollHeight) } as DOMRect);
  restoreGeometry.push(() => {
    if (oldWidth) Object.defineProperty(viewport, "clientWidth", oldWidth); else Reflect.deleteProperty(viewport, "clientWidth");
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

afterEach(() => { cleanup(); const root = (document.scrollingElement as HTMLElement | null) ?? document.documentElement; root.scrollTop = 0; document.documentElement.scrollTop = 0; document.body.scrollTop = 0; restoreGeometry.splice(0).forEach(restore => restore()); mediaListeners.clear(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia); else Reflect.deleteProperty(window, "matchMedia"); if (originalInnerWidth) Object.defineProperty(window, "innerWidth", originalInnerWidth); if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight); });

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

  it("refines only the wide-desktop Split outer columns while preserving the preview cap", () => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    const refinement = css.match(/@media\(min-width:1281px\)\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(refinement).toContain(".preview-route-main>.editor-preview-layout[data-workspace-view=split]");
    expect(refinement).toContain("grid-template-columns:minmax(0,1fr) clamp(530px,max(calc(50vw - 125px),calc(100% - 572px)),680px)");
    expect(refinement).not.toContain("data-workspace-view=edit");
    expect(refinement).not.toContain("data-workspace-view=preview");
    expect(refinement).toContain(".links-editor-scope{--links-split-paired-columns:minmax(280px,2fr) minmax(150px,1fr);--links-split-label-column:104px}");
    expect(refinement).toContain(".links-section[data-editor-anchor=\"links:public-links\"] .links-object-group .links-inline-row{grid-template-columns:var(--links-split-paired-columns)}");
    expect(refinement).toContain(".links-section[data-editor-anchor=\"links:public-links\"] .links-object-group .links-inline-field{grid-template-columns:var(--links-split-label-column) minmax(0,1fr)}");
    expect(refinement).toContain(".links-object-group[data-editor-anchor=\"links:linkedin\"] .links-linkedin-localized .bilingual-field-pair[data-editor-anchor=\"field:links-linkedin-localized:linkedInLabel\"]:not(.is-adaptive-stacked) .bilingual-field-values{grid-template-columns:var(--links-split-paired-columns)}");
    expect(refinement).toContain(".links-linkedin-localized .links-inline-locale-fields .bilingual-field-values .field{grid-template-columns:var(--links-split-label-column) minmax(0,1fr)}");
    expect(refinement).not.toContain("resume-files");
    expect(css).toContain("@media(min-width:1280px){");
    expect(css).toContain(".preview-route-main>.editor-preview-layout{position:relative;width:100%;max-width:1390px;min-width:0;height:100%;min-height:0;flex:1 1 auto;align-items:stretch;grid-template-areas:\"editor preview\";grid-template-columns:minmax(0,1fr) clamp(530px,calc(50vw - 125px),680px)");

    const layoutWidth = (viewportWidth: number) => Math.min(1390, viewportWidth - 190 - 16 * 2);
    const previewWidth = (viewportWidth: number) => {
      const width = layoutWidth(viewportWidth);
      const existingTarget = viewportWidth / 2 - 125;
      const editorComfortTarget = width - 32 - 540;
      return Math.min(680, Math.max(530, existingTarget, editorComfortTarget));
    };

    expect(previewWidth(1280)).toBe(530);
    expect(previewWidth(1281)).toBe(530);
    expect(previewWidth(1366)).toBe(572);
    expect(previewWidth(1403)).toBe(609);
    expect(previewWidth(1440)).toBe(646);
    expect(previewWidth(1600)).toBe(680);
    expect(previewWidth(2048)).toBe(680);
    expect(layoutWidth(1281) - previewWidth(1281) - 32).toBe(497);
    expect(layoutWidth(1366) - previewWidth(1366) - 32).toBe(540);
    expect(layoutWidth(1403) - previewWidth(1403) - 32).toBe(540);
    expect(layoutWidth(1440) - previewWidth(1440) - 32).toBe(540);
    expect(layoutWidth(1600) - previewWidth(1600) - 32).toBe(666);
    expect(layoutWidth(2048) - previewWidth(2048) - 32).toBe(678);
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

  it.each(["edit", "split", "preview"] as const)("uses a saved desktop workspace view %s on the initial render", view => {
    useWideDesktop();
    window.sessionStorage.setItem(workspaceViewKey("profile"), view);
    // The responsive two-state contract remains separate from the desktop three-state preference.
    window.sessionStorage.setItem(modeKey("profile"), "editor");
    renderApp("/profile");
    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    expect(layout.dataset.workspaceView).toBe(view);
    expect(window.sessionStorage.getItem(modeKey("profile"))).toBe("editor");
    expect(window.sessionStorage.getItem(workspaceViewKey("profile"))).toBe(view);
  });

  it.each(destinations.map(([path]) => path))("restores the independent desktop preference for %s", path => {
    const section = path.slice(1) as PreviewSection;
    setViewport(1440);
    window.sessionStorage.setItem(workspaceViewKey(section), "preview");
    renderApp(path);
    expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("preview");
  });

  it("defaults malformed desktop workspace-view storage to Split", () => {
    useWideDesktop();
    window.sessionStorage.setItem(workspaceViewKey("profile"), "side-by-side");
    renderApp("/profile");
    expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split");
    expect(window.sessionStorage.getItem(workspaceViewKey("profile"))).toBe("side-by-side");
  });

  it.each(["edit", "split", "preview"] as const)("persists and restores %s after a same-route hard-remount simulation", view => {
    useWideDesktop();
    const first = renderApp("/profile");
    const switcher = within(screen.getByRole("group", { name: "Workspace view" }));
    if (view === "split") fireEvent.click(switcher.getByRole("button", { name: "Preview" }));
    fireEvent.click(switcher.getByRole("button", { name: view === "edit" ? "Edit" : view === "split" ? "Split" : "Preview" }));
    expect(window.sessionStorage.getItem(workspaceViewKey("profile"))).toBe(view);
    first.unmount();
    renderApp("/profile");
    expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe(view);
  });

  it("keeps desktop workspace view preferences isolated by route", async () => {
    useWideDesktop();
    renderApp("/experience");
    fireEvent.click(within(screen.getByRole("group", { name: "Workspace view" })).getByRole("button", { name: "Preview" }));
    expect(window.sessionStorage.getItem(workspaceViewKey("experience"))).toBe("preview");

    fireEvent.click(within(screen.getByRole("navigation", { name: "CMS sections" })).getByRole("link", { name: "Education" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split"));
    expect(window.sessionStorage.getItem(workspaceViewKey("education"))).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Workspace view" })).getByRole("button", { name: "Edit" }));
    expect(window.sessionStorage.getItem(workspaceViewKey("education"))).toBe("edit");

    fireEvent.click(within(screen.getByRole("navigation", { name: "CMS sections" })).getByRole("link", { name: "Experience" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("preview"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "CMS sections" })).getByRole("link", { name: "Education" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("edit"));
  });

  it("restores a route's saved desktop view on wide re-entry without changing the intermediate two-state preference", async () => {
    window.sessionStorage.setItem(workspaceViewKey("education"), "preview");
    window.sessionStorage.setItem(modeKey("education"), "editor");
    setViewport(1279, true);
    renderApp("/education");
    expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor");
    expect(within(screen.getByRole("group", { name: "Workspace view" })).getAllByRole("button")).toHaveLength(2);

    setViewport(1280, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("preview"));
    expect(window.sessionStorage.getItem(modeKey("education"))).toBe("editor");
    expect(window.sessionStorage.getItem(workspaceViewKey("education"))).toBe("preview");
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
    expect(window.sessionStorage.getItem(workspaceViewKey("profile"))).toBe("preview");
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
    expect(window.sessionStorage.getItem(workspaceViewKey("profile"))).toBe("split");
    expect(editorPane.hidden).toBe(false);
    expect(previewPanel.hidden).toBe(false);
    expect(splitButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(editButton);
    expect(layout.dataset.workspaceView).toBe("edit");
    expect(window.sessionStorage.getItem(workspaceViewKey("profile"))).toBe("edit");
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

  it("keeps exactly the two route-scoped Editor and Preview positions through repeated wide workspace transitions", async () => {
    setViewport(1440);
    renderApp("/profile");
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    mockScrollGeometry(editor, 1800, 600);
    mockScrollGeometry(preview, 2000, 600);
    const switcher = within(screen.getByRole("group", { name: "Workspace view" }));
    const click = async (name: "Edit" | "Split" | "Preview") => {
      fireEvent.click(switcher.getByRole("button", { name }));
      await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe(name.toLowerCase()));
    };
    const scroll = (owner: HTMLElement, value: number) => { owner.scrollTop = value; fireEvent.scroll(owner); };

    scroll(editor, 240);
    scroll(preview, 410);
    await click("Edit");
    await click("Preview");
    expect(editor.scrollTop).toBe(240);
    expect(preview.scrollTop).toBe(410);
    expect([...Array(window.sessionStorage.length)].map((_, index) => window.sessionStorage.key(index))
      .some(key => key?.includes("split-scroll") || key?.includes("workspace-scroll"))).toBe(false);
    await click("Edit");
    await click("Preview");
    expect(editor.scrollTop).toBe(240);
    expect(preview.scrollTop).toBe(410);

    await click("Edit");
    scroll(editor, 520);
    await click("Split");
    expect(editor.scrollTop).toBe(520);
    expect(preview.scrollTop).toBe(410);
    scroll(editor, 760);
    scroll(preview, 880);

    await click("Edit");
    expect(editor.scrollTop).toBe(760);
    await click("Preview");
    expect(preview.scrollTop).toBe(880);
    await click("Split");
    expect(editor.scrollTop).toBe(760);
    expect(preview.scrollTop).toBe(880);
    await click("Preview");
    expect(preview.scrollTop).toBe(880);
    await click("Edit");
    expect(editor.scrollTop).toBe(760);
    await click("Split");
    expect(editor.scrollTop).toBe(760);
    expect(preview.scrollTop).toBe(880);
  });

  it("preserves the Preview canvas location when its scale changes in both directions", async () => {
    setViewport(1280);
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview") as HTMLElement;
    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    mockPreviewGeometry(viewport, 0.6, 3600, 600, 588);
    viewport.scrollTop = 900;
    fireEvent.scroll(viewport);
    const switcher = () => within(screen.getByRole("group", { name: "Workspace view" }));

    fireEvent.click(switcher().getByRole("button", { name: "Preview" }));
    mockPreviewGeometry(viewport, 1, 5000, 600, 980);
    await waitFor(() => expect(layout.dataset.workspaceView).toBe("preview"));
    await waitFor(() => expect(viewport.scrollTop).toBe(1500));

    viewport.scrollTop = 2100;
    fireEvent.scroll(viewport);
    fireEvent.click(switcher().getByRole("button", { name: "Split" }));
    mockPreviewGeometry(viewport, 0.6, 2400, 600, 588);
    await waitFor(() => expect(layout.dataset.workspaceView).toBe("split"));
    await waitFor(() => expect(viewport.scrollTop).toBe(1260));
    expect(viewport.scrollTop / 0.6).toBeCloseTo(2100);
  });

  it("waits for Preview scale and stage geometry to settle before applying a saved canvas coordinate", async () => {
    setViewport(1280);
    renderApp("/education");
    const viewport = screen.getByTestId("resume-preview") as HTMLElement;
    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    mockPreviewGeometry(viewport, 0.6, 3600, 600, 588);
    viewport.scrollTop = 900;
    fireEvent.scroll(viewport);

    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    fireEvent.click(within(screen.getByRole("group", { name: "Workspace view" })).getByRole("button", { name: "Preview" }));
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(0));
    expect(viewport.scrollTop).toBe(900);

    mockPreviewGeometry(viewport, 1, 5000, 600, 980);
    for (let frame = 0; frame < 4 && frames.length; frame += 1) act(() => frames.shift()?.(frame + 1));
    expect(layout.dataset.workspaceView).toBe("preview");
    expect(viewport.scrollTop).toBe(1500);
  });

  it("normalizes Editor progress when the Editor track reflows between Split and Edit", async () => {
    setViewport(1440);
    renderApp("/profile");
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    mockScrollGeometry(editor, 1800, 600);
    editor.scrollTop = 300;
    fireEvent.scroll(editor);
    const switcher = () => within(screen.getByRole("group", { name: "Workspace view" }));

    fireEvent.click(switcher().getByRole("button", { name: "Edit" }));
    mockScrollGeometry(editor, 2600, 600);
    await waitFor(() => expect(layout.dataset.workspaceView).toBe("edit"));
    await waitFor(() => expect(editor.scrollTop).toBe(500));

    editor.scrollTop = 750;
    fireEvent.scroll(editor);
    fireEvent.click(switcher().getByRole("button", { name: "Split" }));
    mockScrollGeometry(editor, 1800, 600);
    await waitFor(() => expect(layout.dataset.workspaceView).toBe("split"));
    await waitFor(() => expect(editor.scrollTop).toBe(450));
  });

  it("preserves a semantic Editor anchor through Split/Edit reflow cycles without cumulative drift", async () => {
    setViewport(1440);
    renderApp("/links");
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const viewportTop = 100;
    const anchor = document.querySelector<HTMLElement>('[data-editor-anchor="links:resume-files"]')!;
    let anchorContentTop = 930;
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ top: viewportTop, bottom: 700, height: 600, width: 500 } as DOMRect);
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: viewportTop + anchorContentTop - editor.scrollTop, bottom: viewportTop + anchorContentTop - editor.scrollTop + 36, height: 36, width: 400 } as DOMRect));
    mockScrollGeometry(editor, 2600, 600);
    editor.scrollTop = 910;
    fireEvent.scroll(editor);
    const switcher = () => within(screen.getByRole("group", { name: "Workspace view" }));
    const expectAnchorAt = async (offset: number) => waitFor(() => expect(anchor.getBoundingClientRect().top - viewportTop).toBeCloseTo(offset, 0));

    fireEvent.click(switcher().getByRole("button", { name: "Edit" }));
    anchorContentTop += 430;
    mockScrollGeometry(editor, 3300, 600);
    await expectAnchorAt(20);

    editor.scrollTop = anchorContentTop - 54;
    fireEvent.scroll(editor);
    fireEvent.click(switcher().getByRole("button", { name: "Split" }));
    anchorContentTop -= 275;
    mockScrollGeometry(editor, 2600, 600);
    await expectAnchorAt(54);

    editor.scrollTop = anchorContentTop - 37;
    fireEvent.scroll(editor);
    fireEvent.click(switcher().getByRole("button", { name: "Edit" }));
    anchorContentTop += 190;
    mockScrollGeometry(editor, 3100, 600);
    await expectAnchorAt(37);

    editor.scrollTop = anchorContentTop - 37;
    fireEvent.scroll(editor);
    fireEvent.click(switcher().getByRole("button", { name: "Split" }));
    anchorContentTop -= 120;
    mockScrollGeometry(editor, 2600, 600);
    await expectAnchorAt(37);
  });

  it("does not overwrite a hidden Editor anchor while Preview is active", async () => {
    setViewport(1440);
    renderApp("/links");
    const editorPane = document.querySelector<HTMLElement>(".editor-preview-pane")!;
    const editor = editorPane.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    const anchor = document.querySelector<HTMLElement>('[data-editor-anchor="links:navigation-labels"]')!;
    const viewportTop = 80;
    let anchorContentTop = 850;
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ top: viewportTop, bottom: 680, height: 600, width: 500 } as DOMRect);
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: viewportTop + anchorContentTop - editor.scrollTop, bottom: viewportTop + anchorContentTop - editor.scrollTop + 30, height: 30, width: 400 } as DOMRect));
    mockScrollGeometry(editor, 2500, 600);
    editor.scrollTop = 830;
    fireEvent.scroll(editor);

    const switcher = () => within(screen.getByRole("group", { name: "Workspace view" }));
    fireEvent.click(switcher().getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(editorPane.hidden).toBe(true));
    editor.scrollTop = 0;
    fireEvent.scroll(editor);
    anchorContentTop += 360;
    fireEvent.click(switcher().getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(editorPane.hidden).toBe(false));
    await waitFor(() => expect(anchor.getBoundingClientRect().top - viewportTop).toBeCloseTo(20, 0));
    expect(preview).toBeTruthy();
  });

  it("keeps an Editor anchor and the Preview canvas location independent through Edit/Preview/Split", async () => {
    setViewport(1440);
    renderApp("/links");
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    const anchor = document.querySelector<HTMLElement>('[data-editor-anchor="links:navigation-labels"]')!;
    const viewportTop = 90;
    const anchorContentTop = 1050;
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ top: viewportTop, bottom: 690, height: 600, width: 500 } as DOMRect);
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: viewportTop + anchorContentTop - editor.scrollTop, bottom: viewportTop + anchorContentTop - editor.scrollTop + 32, height: 32, width: 420 } as DOMRect));
    mockScrollGeometry(editor, 2600, 600);
    mockPreviewGeometry(preview, 1, 4000, 600, 980);
    editor.scrollTop = 1030;
    preview.scrollTop = 700;
    fireEvent.scroll(editor);
    fireEvent.scroll(preview);
    const switcher = () => within(screen.getByRole("group", { name: "Workspace view" }));

    fireEvent.click(switcher().getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(anchor.getBoundingClientRect().top - viewportTop).toBeCloseTo(20, 0));
    editor.scrollTop = anchorContentTop - 55;
    fireEvent.scroll(editor);

    fireEvent.click(switcher().getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("preview"));
    await waitFor(() => expect(preview.scrollTop).toBe(700));
    fireEvent.click(switcher().getByRole("button", { name: "Split" }));
    await waitFor(() => expect(anchor.getBoundingClientRect().top - viewportTop).toBeCloseTo(55, 0));
    expect(preview.scrollTop).toBe(700);
  });

  it("does not restore a previous route's Editor anchor into the next route", async () => {
    setViewport(1440);
    renderApp("/links", true);
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const anchor = document.querySelector<HTMLElement>('[data-editor-anchor="links:resume-files"]')!;
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 700, height: 600, width: 500 } as DOMRect);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ top: 120, bottom: 150, height: 30, width: 400 } as DOMRect);
    mockScrollGeometry(editor, 2600, 600);
    editor.scrollTop = 800;
    fireEvent.scroll(editor);

    fireEvent.click(screen.getByRole("button", { name: "/education" }));
    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/education"));
    const nextEditor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    expect(document.querySelector('[data-editor-anchor="links:resume-files"]')).toBeNull();
    expect(nextEditor.scrollTop).toBe(0);
  });

  it("falls back safely when a saved Editor anchor no longer exists", async () => {
    setViewport(1440);
    renderApp("/links");
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const anchor = document.querySelector<HTMLElement>('[data-editor-anchor="links:resume-files"]')!;
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 700, height: 600, width: 500 } as DOMRect);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ top: 120, bottom: 150, height: 30, width: 400 } as DOMRect);
    mockScrollGeometry(editor, 1600, 600);
    editor.scrollTop = 400;
    fireEvent.scroll(editor);

    fireEvent.click(within(screen.getByRole("group", { name: "Workspace view" })).getByRole("button", { name: "Edit" }));
    anchor.removeAttribute("data-editor-anchor");
    mockScrollGeometry(editor, 2600, 600);
    await waitFor(() => expect(editor.scrollTop).toBe(800));
  });

  it("restores Editor anchors when the active scroll owner changes between an element and the document", async () => {
    setViewport(861, true);
    renderApp("/links");
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    const documentOwner = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const anchor = document.querySelector<HTMLElement>('[data-editor-anchor="links:resume-files"]')!;
    const elementTop = 100;
    let elementContentTop = 900;
    const documentContentTop = 640;
    let geometryOwner: "element" | "document" = "element";
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ top: elementTop, bottom: 700, height: 600, width: 500 } as DOMRect);
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => geometryOwner === "element"
      ? ({ top: elementTop + elementContentTop - editor.scrollTop, bottom: elementTop + elementContentTop - editor.scrollTop + 30, height: 30, width: 400 } as DOMRect)
      : ({ top: documentContentTop - documentOwner.scrollTop, bottom: documentContentTop - documentOwner.scrollTop + 30, height: 30, width: 400 } as DOMRect));
    mockScrollGeometry(editor, 1800, 600);
    mockScrollGeometry(documentOwner, 2000, 700);
    editor.scrollTop = 880;
    fireEvent.scroll(editor);

    setViewport(860, false, true);
    geometryOwner = "document";
    await waitFor(() => expect(documentOwner.scrollTop).toBe(620));
    expect(anchor.getBoundingClientRect().top).toBeCloseTo(20, 0);

    setViewport(861, true, true);
    geometryOwner = "element";
    elementContentTop = 1100;
    await waitFor(() => expect(editor.scrollTop).toBe(1080));
    expect(anchor.getBoundingClientRect().top - elementTop).toBeCloseTo(20, 0);
  });

  it.each(destinations.map(([path]) => path))("renders stable Editor anchors within the active route at %s", path => {
    setViewport(1440);
    const view = renderApp(path);
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll")!;
    const anchors = Array.from(editor.querySelectorAll<HTMLElement>("[data-editor-anchor]"));
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every(anchor => Boolean(anchor.dataset.editorAnchor?.trim()))).toBe(true);
    expect(new Set(anchors.map(anchor => anchor.dataset.editorAnchor)).size).toBe(anchors.length);
    view.unmount();
  });

  it("preserves independent logical Editor and Preview positions through the complete six-transition workspace flow", async () => {
    setViewport(1440);
    renderApp("/profile");
    const layout = document.querySelector<HTMLElement>(".editor-preview-layout")!;
    const editor = layout.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    mockScrollGeometry(editor, 1800, 600);
    mockPreviewGeometry(preview, 0.6, 3600, 600, 588);
    editor.scrollTop = 300;
    preview.scrollTop = 600;
    fireEvent.scroll(editor);
    fireEvent.scroll(preview);
    const switcher = () => within(screen.getByRole("group", { name: "Workspace view" }));

    fireEvent.click(switcher().getByRole("button", { name: "Edit" }));
    mockScrollGeometry(editor, 2600, 600);
    await waitFor(() => expect(editor.scrollTop).toBe(500));
    editor.scrollTop = 800;
    fireEvent.scroll(editor);

    fireEvent.click(switcher().getByRole("button", { name: "Preview" }));
    mockPreviewGeometry(preview, 1, 5000, 600, 980);
    await waitFor(() => expect(preview.scrollTop).toBe(1000));
    preview.scrollTop = 2200;
    fireEvent.scroll(preview);

    fireEvent.click(switcher().getByRole("button", { name: "Split" }));
    mockScrollGeometry(editor, 1800, 600);
    mockPreviewGeometry(preview, 0.6, 4200, 600, 588);
    await waitFor(() => expect(editor.scrollTop).toBe(480));
    await waitFor(() => expect(preview.scrollTop).toBe(1320));

    fireEvent.click(switcher().getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(preview.scrollTop / Number(preview.dataset.previewScale)).toBeCloseTo(2200));
    fireEvent.click(switcher().getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(editor.scrollTop).toBe(480));
    fireEvent.click(switcher().getByRole("button", { name: "Split" }));
    await waitFor(() => expect(editor.scrollTop).toBe(480));
    await waitFor(() => expect(preview.scrollTop / Number(preview.dataset.previewScale)).toBeCloseTo(2200));
    expect(layout.dataset.workspaceView).toBe("split");
  });

  it("does not read or write a hidden pane as the source of its saved position", async () => {
    setViewport(1440);
    renderApp("/education");
    const editorPane = document.querySelector<HTMLElement>(".editor-preview-pane")!;
    const editor = editorPane.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    const previewPanel = preview.closest<HTMLElement>(".resume-preview-panel")!;
    let editorPosition = 240;
    let previewPosition = 410;
    Object.defineProperty(editor, "scrollTop", { configurable: true, get: () => editorPane.hidden ? 0 : editorPosition, set: value => { if (!editorPane.hidden) editorPosition = value; } });
    Object.defineProperty(preview, "scrollTop", { configurable: true, get: () => previewPanel.hidden ? 0 : previewPosition, set: value => { if (!previewPanel.hidden) previewPosition = value; } });
    fireEvent.scroll(editor);
    fireEvent.scroll(preview);
    const switcher = within(screen.getByRole("group", { name: "Workspace view" }));

    fireEvent.click(switcher.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("edit"));
    expect(previewPanel.hidden).toBe(true);
    expect(preview.scrollTop).toBe(0);
    editorPosition = 520;
    fireEvent.scroll(editor);
    fireEvent.click(switcher.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split"));
    await waitFor(() => expect(preview.scrollTop).toBe(410));
    expect(editor.scrollTop).toBe(520);

    fireEvent.click(switcher.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("preview"));
    expect(editorPane.hidden).toBe(true);
    expect(editor.scrollTop).toBe(0);
    previewPosition = 690;
    fireEvent.scroll(preview);
    fireEvent.click(switcher.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("split"));
    await waitFor(() => expect(editor.scrollTop).toBe(520));
    expect(preview.scrollTop).toBe(690);
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

  it("places the localized public-site action after the desktop workspace switcher, outside account controls", () => {
    setViewport(1280);
    renderApp("/education");

    const header = document.querySelector<HTMLElement>(".topbar")!;
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const siteLink = header.querySelector<HTMLAnchorElement>(".topbar-public-site-link")!;
    const sidebarLink = document.querySelector<HTMLAnchorElement>(".sidebar-public-site-link")!;
    expect(siteLink.getAttribute("href")).toBe("https://example-cv.com");
    expect(siteLink.getAttribute("target")).toBe("_blank");
    expect(siteLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(siteLink.textContent).toBe("View site ↗");
    expect(siteLink.parentElement).toBe(document.querySelector(".topbar-left"));
    expect(document.querySelector(".topbar-workspace-slot")?.nextElementSibling).toBe(siteLink);
    expect(document.querySelector(".account-placeholder .public-site-link")).toBeNull();
    expect(sidebarLink.getAttribute("href")).toBe(siteLink.getAttribute("href"));
    expect(sidebarLink.getAttribute("target")).toBe(siteLink.getAttribute("target"));
    expect(sidebarLink.getAttribute("rel")).toBe(siteLink.getAttribute("rel"));
    expect(within(switcher).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(switcher).getByRole("button", { name: "Split" })).toBeTruthy();
    expect(within(switcher).getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Sign Out" })).toBeTruthy();
    expect(within(header).getByText("admin@example.test")).toBeTruthy();
    expect(document.querySelector('[role="group"][aria-label="CMS interface language"]')).not.toBeNull();
    expect(document.querySelector('[data-workspace-view="split"]')).not.toBeNull();

    fireEvent.click(within(header).getByRole("button", { name: "中文" }));
    expect(siteLink.textContent).toBe("查看网站 ↗");
    expect(sidebarLink.textContent).toBe("查看网站 ↗");
    expect(screen.getByRole("group", { name: "工作区视图" })).toBeTruthy();
    expect(screen.getByTestId("current-route").textContent).toBe("/education");
  });

  it("keeps the site action beside the 861px fine-pointer Header two-state switcher", () => {
    setViewport(861, true);
    renderApp("/education");
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const headerLink = document.querySelector(".topbar-left .topbar-public-site-link");

    expect(headerLink?.previousElementSibling?.classList.contains("topbar-workspace-slot")).toBe(true);
    expect(within(switcher).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(switcher).getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(within(switcher).queryByRole("button", { name: "Split" })).toBeNull();
  });

  it.each([860, 640, 390])("keeps the localized site action in the existing mobile sidebar navigation at %ipx", width => {
    setViewport(width);
    window.localStorage.setItem("cms-ui-locale", "zh");
    renderApp("/education");
    const mobileLink = document.querySelector<HTMLAnchorElement>(".sidebar .sidebar-public-site-link")!;
    const desktopLink = document.querySelector<HTMLAnchorElement>(".topbar-public-site-link")!;
    const styles = readFileSync("src/styles.css", "utf8");

    expect(mobileLink.textContent).toBe("查看网站 ↗");
    expect(mobileLink.getAttribute("href")).toBe("https://example-cv.com");
    expect(mobileLink.getAttribute("target")).toBe("_blank");
    expect(mobileLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(styles).toContain("@media(max-width:860px){.topbar-public-site-link{display:none}.sidebar-public-site-link{display:block");
    expect(styles).not.toMatch(/@media\(max-width:640px\)[^}]*\.public-site-link\{display:none/);
    expect(desktopLink.parentElement?.classList.contains("topbar-left")).toBe(true);
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
    await waitFor(() => expect(editor.scrollTop).toBe(240));
    expect(name.value).toBe("Intermediate desktop draft");
    expect(document.querySelector(".editor-action-footer .state-pill")?.textContent).toBe("Unsaved changes");
  });

  it("preserves independent Editor and Preview positions through repeated 1279px mode switches", async () => {
    setViewport(1279, true);
    renderApp("/education");
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;

    editor.scrollTop = 240;
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    documentScrollOwner.scrollTop = 410;
    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor"));
    await waitFor(() => expect(editor.scrollTop).toBe(240));
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(410));
    expect(editor.scrollTop).toBe(240);

    editor.scrollTop = 520;
    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor"));
    await waitFor(() => expect(editor.scrollTop).toBe(520));
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(410));
    documentScrollOwner.scrollTop = 690;
    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor"));
    await waitFor(() => expect(editor.scrollTop).toBe(520));
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(690));

    expect(screen.getByTestId("resume-preview").getAttribute("data-preview-scroll-mode")).toBe("document");
  });

  it("restores Editor progress against the incoming geometry instead of preserving its old raw offset", async () => {
    setViewport(1279, true);
    renderApp("/education");
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    mockScrollGeometry(editor, 1500, 500);
    editor.scrollTop = 240;
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    documentScrollOwner.scrollTop = 410;
    mockScrollGeometry(editor, 2500, 500);
    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(editor.scrollTop).toBe(480));
  });

  it("settles at the maximum reachable position when a saved mode position is beyond the current content range", async () => {
    setViewport(1279, true);
    renderApp("/education");
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    const switcher = screen.getByRole("group", { name: "Workspace view" });
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    mockScrollGeometry(editor, 1500, 500);
    editor.scrollTop = 1000;
    fireEvent.click(within(switcher).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    documentScrollOwner.scrollTop = 410;

    let position = 1000;
    let writes = 0;
    const previousScrollTop = Object.getOwnPropertyDescriptor(editor, "scrollTop");
    const previousScrollHeight = Object.getOwnPropertyDescriptor(editor, "scrollHeight");
    const previousClientHeight = Object.getOwnPropertyDescriptor(editor, "clientHeight");
    Object.defineProperties(editor, {
      scrollTop: { configurable: true, get: () => position, set: (value: number) => { writes += 1; position = Math.min(value, 100); } },
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 500 },
    });
    restoreGeometry.push(() => {
      if (previousScrollTop) Object.defineProperty(editor, "scrollTop", previousScrollTop); else Reflect.deleteProperty(editor, "scrollTop");
      if (previousScrollHeight) Object.defineProperty(editor, "scrollHeight", previousScrollHeight); else Reflect.deleteProperty(editor, "scrollHeight");
      if (previousClientHeight) Object.defineProperty(editor, "clientHeight", previousClientHeight); else Reflect.deleteProperty(editor, "clientHeight");
    });

    fireEvent.click(within(switcher).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(writes).toBe(1));
    expect(position).toBe(100);
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
    mockPreviewGeometry(viewport, 1, 1600, 600, 980);
    mockScrollGeometry(documentOwner, 3000, 720);
    vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(() => ({ top: 300 - documentOwner.scrollTop, bottom: 900 - documentOwner.scrollTop, width: 980, height: 600 } as DOMRect));
    viewport.scrollTop = 250;
    fireEvent.scroll(viewport);
    fireEvent.click(within(screen.getByRole("group", { name: "Workspace view" })).getByRole("button", { name: "Preview" }));
    mockPreviewGeometry(viewport, 1, 2600, 600, 980);
    await waitFor(() => expect(viewport.scrollTop).toBe(250));

    setViewport(1279, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    await waitFor(() => expect(documentOwner.scrollTop).toBe(550));
    setViewport(1280, true, true);
    mockPreviewGeometry(viewport, 1, 1600, 600, 980);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe("preview"));
    expect(viewport.scrollTop).toBe(250);
  });

  it.each(["split", "edit", "preview"] as const)("preserves both logical pane positions across a 1280/1279 round trip from wide %s", async startingView => {
    setViewport(1280, true);
    renderApp("/education");
    const editor = document.querySelector<HTMLElement>("[data-editor-scroll-owner]")!;
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    const documentOwner = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    mockScrollGeometry(editor, 1800, 800);
    mockScrollGeometry(preview, 1800, 800);
    mockScrollGeometry(documentOwner, 1800, 800);
    const switcher = () => within(screen.getByRole("group", { name: "Workspace view" }));
    const setScroll = (owner: HTMLElement, value: number) => { owner.scrollTop = value; fireEvent.scroll(owner); };

    setScroll(editor, 300);
    setScroll(preview, 600);
    if (startingView !== "split") {
      fireEvent.click(switcher().getByRole("button", { name: startingView === "edit" ? "Edit" : "Preview" }));
      await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe(startingView));
    }
    // workspace-view is separate from preview-mode; the latter continues to drive the 1279px two-state layout.
    expect(window.sessionStorage.getItem(workspaceViewKey("education"))).toBe(startingView === "split" ? null : startingView);

    setViewport(1279, true, true);
    await waitFor(() => expect(switcher().getAllByRole("button")).toHaveLength(2));
    setViewport(1280, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-workspace-view")).toBe(startingView));
    await waitFor(() => expect(editor.scrollTop).toBe(300));
    await waitFor(() => expect(preview.scrollTop).toBe(600));
  });

  it("hands Editor position proportionally between its pane and document across 861/860", async () => {
    setViewport(861, true);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
    renderApp("/profile");
    const editor = document.querySelector<HTMLElement>(".editor-content-scroll[data-editor-scroll-owner]")!;
    const documentOwner = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    mockScrollGeometry(editor, 1500, 500);
    mockScrollGeometry(documentOwner, 2720, 720);
    editor.scrollTop = 400;

    setViewport(860, true, true);
    await waitFor(() => expect(document.querySelector(".editor-preview-pane")?.getAttribute("data-editor-scroll-mode")).toBe("document"));
    await waitFor(() => expect(documentOwner.scrollTop).toBe(800));
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

  it("restores independent Editor and Preview document positions when switching modes on one route", async () => {
    renderApp("/experience");
    const documentScrollOwner = document.scrollingElement ?? document.documentElement;
    documentScrollOwner.scrollTop = 420;

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    documentScrollOwner.scrollTop = 910;
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(420));

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(910));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(420));
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

    documentScrollOwner.scrollTop = 280;
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    documentScrollOwner.scrollTop = 360;
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("editor"));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(280));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(document.querySelector(".editor-preview-layout")?.getAttribute("data-preview-view")).toBe("preview"));
    await waitFor(() => expect(documentScrollOwner.scrollTop).toBe(360));

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
    const writeLock = pane.querySelector<HTMLElement>(".editor-write-lock")!;
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
    const firstWriteLockChild = writeLock.firstElementChild;
    expect(firstWriteLockChild).not.toBeNull();
    expect(firstWriteLockChild?.contains(routeFrame!)).toBe(true);
    if (path === "/profile" || path === "/education") expect(firstWriteLockChild).toBe(routeFrame);
    else expect(firstWriteLockChild).not.toBe(routeFrame);
    expect(pane.hasAttribute("data-editor-scroll-owner")).toBe(false);
    expect(preview.closest(".resume-preview-panel")?.parentElement).toBe(layout);
    expect(layout.querySelectorAll("[data-editor-scroll-owner]")).toHaveLength(1);
    expect(layout.querySelectorAll("[data-preview-scroll-owner]")).toHaveLength(1);
  });

  it("keeps the desktop Editor content viewport and action footer as separate workspace rows", () => {
    const css = readFileSync("src/preview/preview.css", "utf8");
    const desktopRules = css.match(/@media\(min-width:1280px\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const paneRule = desktopRules.match(/\.editor-preview-pane\{([^}]*)\}/)?.[1] ?? "";
    const frameRule = desktopRules.match(/\n\s*\.editor-workspace-route\{([^}]*)\}/)?.[1] ?? "";
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
    expect(css).toContain(".editor-preview-pane>.editor-write-lock>:first-child{height:100%;min-height:0}");
    expect(css).toContain(".app-main.has-preview-workspace.is-editor-only-desktop .editor-preview-layout[data-preview-view=editor] .editor-preview-pane>.editor-write-lock>:first-child{height:100%;min-height:0}");
    expect(css).not.toContain(".editor-preview-pane>.editor-write-lock>.editor-workspace-route{height:100%;min-height:0}");
    expect(css).toContain(".editor-write-lock{display:contents}");
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
