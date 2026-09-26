import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { ComponentProps } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import { ResumeLoader } from "../src/data/ResumeLoader";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import type { ResumeRepository } from "../src/data/resumeRepository";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";
import { freezeExistingScrollSnapshot, isScrollSnapshotFrozen, resetScrollSnapshotFreezesForTests, writeStoredScrollPosition } from "../src/refreshState";

const resume = {
  resumeId: "refresh-resume", siteKey: "example-cv" as const, isPublished: true, updatedAt: null,
  sections: structuredClone(fixtureSections),
};
const uiKey = "example-cv-cms:ui:";
const scrollOwner = () => (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
const scrollKey = (pathname: string, mode: "editor" | "preview" = "editor") => `${uiKey}scroll:${pathname}:${mode}`;

function mockDocumentReload() {
  // Each simulated reload creates a fresh JS document/module lifecycle.
  resetScrollSnapshotFreezesForTests();
  vi.spyOn(window.performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming] as unknown as PerformanceEntryList);
}

function open(path: string, props: Partial<ComponentProps<typeof App>> = {}, reload = false) {
  if (reload) mockDocumentReload();
  return render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><PathnameProbe /><App identityEmail="admin@example.test"
    onSignOut={() => {}} signOutPending={false} signOutError="" {...props} /></MemoryRouter></UiLocaleProvider>);
}

function PathnameProbe() { const location = useLocation(); return <div data-testid="current-path">{location.pathname}</div>; }

beforeEach(() => {
  MockResizeObserver.reset();
  Object.defineProperty(scrollOwner(), "scrollHeight", { configurable: true, value: 2400 });
  Object.defineProperty(scrollOwner(), "clientHeight", { configurable: true, value: 600 });
  scrollOwner().scrollTop = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 1; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "readyState");
  Reflect.deleteProperty(document, "fonts");
  window.sessionStorage.clear();
  scrollOwner().scrollTop = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("route-scoped refresh restoration", () => {
  const resumePaths = ["/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links"];

  it.each(resumePaths)("keeps the Editor scroll owner isolated over two reloads for %s", path => {
    const key = scrollKey(path, "editor");
    window.sessionStorage.setItem(key, "240");
    const first = open(path, { resume }, true);
    expect(scrollOwner().scrollTop).toBe(240);
    fireEvent.wheel(window);
    scrollOwner().scrollTop = 430;
    window.dispatchEvent(new Event("scroll"));
    expect(window.sessionStorage.getItem(key)).toBe("430");
    first.unmount();

    const second = open(path, { resume }, true);
    expect(scrollOwner().scrollTop).toBe(430);
    fireEvent.wheel(window);
    scrollOwner().scrollTop = 0;
    window.dispatchEvent(new Event("scroll"));
    expect(window.sessionStorage.getItem(key)).toBe("0");
    second.unmount();

    const third = open(path, { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);
    third.unmount();
  });

  it.each(resumePaths)("keeps the Preview mode and scroll owner isolated over two reloads for %s", path => {
    const section = path.slice(1);
    const key = scrollKey(path, "preview");
    window.sessionStorage.setItem(`${uiKey}preview-mode:${section}`, "preview");
    window.sessionStorage.setItem(key, "180");

    for (let reload = 0; reload < 3; reload += 1) {
      const view = open(path, { resume }, true);
      const preview = screen.getByTestId("resume-preview") as HTMLElement;
      Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 900 });
      Object.defineProperty(preview, "clientHeight", { configurable: true, value: 500 });
      MockResizeObserver.notify();
      expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
      expect(preview.scrollTop).toBe(reload === 0 ? 180 : reload === 1 ? 320 : 0);
      expect(scrollOwner().scrollTop).toBe(0);
      if (reload === 0) {
        act(() => {
          preview.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
          preview.scrollTop = 320;
          preview.dispatchEvent(new Event("scroll"));
        });
        expect(window.sessionStorage.getItem(key)).toBe("320");
      } else if (reload === 1) {
        act(() => {
          preview.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
          preview.scrollTop = 0;
          preview.dispatchEvent(new Event("scroll"));
        });
        expect(window.sessionStorage.getItem(key)).toBe("0");
      }
      view.unmount();
    }
  });

  it("restores Preview mode after remounting the same route", () => {
    const first = open("/profile");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(window.sessionStorage.getItem(`${uiKey}preview-mode:profile`)).toBe("preview");
    first.unmount();

    open("/profile");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("restores Editor mode and does not leak another route's Preview preference", () => {
    window.sessionStorage.setItem(`${uiKey}preview-mode:experience`, "preview");
    const experience = open("/experience");
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(window.sessionStorage.getItem(`${uiKey}preview-mode:experience`)).toBe("editor");
    experience.unmount();

    open("/projects");
    expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("falls back to Editor for malformed route-scoped mode values", () => {
    window.sessionStorage.setItem(`${uiKey}preview-mode:profile`, "split-view");
    open("/profile");
    expect(screen.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("false");
  });

  it.each(["/experience", "/skills"])("restores document scrolling on %s after route data and layout are ready", async path => {
    const key = scrollKey(path);
    window.sessionStorage.setItem(key, "600");
    Object.defineProperty(scrollOwner(), "scrollHeight", { configurable: true, value: 600 });
    const route = path.slice(1) as "experience" | "skills";
    const view = open(path, { productionMode: true, additionalRouteKey: route, additionalRouteFirst: true, additionalRouteLoadState: "loading" }, true);
    expect(scrollOwner().scrollTop).toBe(0);
    scrollOwner().dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("pagehide"));
    expect(window.sessionStorage.getItem(key)).toBe("600");

    view.rerender(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><PathnameProbe /><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" productionMode={true}
      additionalRouteKey={route} additionalRouteFirst={true} additionalRouteLoadState="loading"
      additionalSections={{ [route]: fixtureSections[route] }} /></MemoryRouter></UiLocaleProvider>);
    expect(scrollOwner().scrollTop).toBe(0);
    scrollOwner().dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("pagehide"));
    expect(window.sessionStorage.getItem(key)).toBe("600");

    Object.defineProperty(scrollOwner(), "scrollHeight", { configurable: true, value: 1200 });
    expect(scrollOwner().scrollHeight - scrollOwner().clientHeight).toBe(600);
    expect(MockResizeObserver.count()).toBeGreaterThan(0);
    MockResizeObserver.notify();
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(scrollOwner().scrollTop).toBe(600));
    expect(screen.getByTestId("current-path").textContent).toBe(path);
    expect(screen.getByRole("heading", { name: route === "skills" ? "Skills" : "Experience", level: 1 })).toBeTruthy();
    window.dispatchEvent(new Event("pagehide"));
    expect(window.sessionStorage.getItem(key)).toBe("600");

    scrollOwner().scrollTop = 260;
    view.rerender(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><PathnameProbe /><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" productionMode={true}
      additionalRouteKey={route} additionalRouteFirst={true} additionalRouteLoadState="loading"
      additionalSections={{ [route]: fixtureSections[route] }} /></MemoryRouter></UiLocaleProvider>);
    expect(scrollOwner().scrollTop).toBe(260);
  });

  it("does not apply another route's saved scroll position", () => {
    window.sessionStorage.setItem(scrollKey("/experience"), "385");
    open("/projects", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);
  });

  it("ignores malformed scroll data safely", () => {
    window.sessionStorage.setItem(`${uiKey}scroll:/experience`, "not-a-position");
    open("/experience", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);
  });

  it("does not issue a redundant scroll call for the top position", () => {
    window.sessionStorage.setItem(scrollKey("/experience"), "0");
    open("/experience", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);
  });

  it("does not restore another route's position or change scroll during normal navigation", () => {
    window.sessionStorage.setItem(scrollKey("/projects"), "400");
    open("/experience", { resume });
    fireEvent.click(screen.getByRole("link", { name: "Projects" }));
    expect(screen.getByTestId("current-path").textContent).toBe("/projects");
    expect(scrollOwner().scrollTop).toBe(0);
  });

  it("does not clamp a saved position to a temporary short layout", () => {
    window.sessionStorage.setItem(scrollKey("/skills"), "5000");
    open("/skills", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);
    expect(window.sessionStorage.getItem(scrollKey("/skills"))).toBe("5000");
  });

  it("lets a genuine user scroll take ownership while a saved target is still unreachable", () => {
    const key = scrollKey("/skills", "editor");
    window.sessionStorage.setItem(key, "5000");
    open("/skills", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);

    fireEvent.wheel(window);
    scrollOwner().scrollTop = 140;
    window.dispatchEvent(new Event("scroll"));
    expect(window.sessionStorage.getItem(key)).toBe("140");

    Object.defineProperty(scrollOwner(), "scrollHeight", { configurable: true, value: 6000 });
    MockResizeObserver.notify();
    expect(scrollOwner().scrollTop).toBe(140);
  });

  it("applies a restored position once and does not fight later renders", () => {
    window.sessionStorage.setItem(scrollKey("/skills"), "385");
    const view = open("/skills", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(385);
    scrollOwner().scrollTop = 260;
    MockResizeObserver.notify();
    view.rerender(<UiLocaleProvider><MemoryRouter initialEntries={["/skills"]}><PathnameProbe /><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} /></MemoryRouter></UiLocaleProvider>);
    expect(scrollOwner().scrollTop).toBe(260);
  });

  it("stores the current route scroll position in session-local state", () => {
    const view = open("/experience", { resume });
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 172;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(window.sessionStorage.getItem(scrollKey("/experience"))).toBe("172");
    view.unmount();
  });

  it("does not treat Cmd+R's incidental scroll-to-zero as a user position", () => {
    const key = scrollKey("/experience", "editor");
    const first = open("/experience", { resume });
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 420;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(window.sessionStorage.getItem(key)).toBe("420");

    fireEvent.keyDown(window, { key: "r", metaKey: true });
    scrollOwner().scrollTop = 0;
    window.dispatchEvent(new Event("scroll"));
    expect(window.sessionStorage.getItem(key)).toBe("420");
    first.unmount();

    open("/experience", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(420);
  });

  it.each([
    ["Cmd+R", { key: "r", metaKey: true }],
    ["Ctrl+R", { key: "r", ctrlKey: true }],
    ["F5", { key: "F5" }],
  ])("freezes the exact /skills Editor coordinate on %s and restores it after later old-document scrolls", (_label, keyEvent) => {
    const key = scrollKey("/skills", "editor");
    const first = open("/skills", { resume });
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 700;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(window.sessionStorage.getItem(key)).toBe("700");

    fireEvent.keyDown(window, keyEvent);
    expect(isScrollSnapshotFrozen("/skills", "editor")).toBe(true);
    expect(window.sessionStorage.getItem(key)).toBe("700");

    // Simulate both an incidental old-document event and a delayed stale writer.
    scrollOwner().scrollTop = 850;
    window.dispatchEvent(new Event("scroll"));
    writeStoredScrollPosition("/skills", "editor", 850);
    expect(window.sessionStorage.getItem(key)).toBe("700");
    first.unmount();

    open("/skills", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(700);
    expect(window.sessionStorage.getItem(key)).toBe("700");
  });

  it("freezes a genuine top position of zero and restores zero after later writes", () => {
    const key = scrollKey("/skills", "editor");
    const first = open("/skills", { resume });
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 180;
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 0;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(window.sessionStorage.getItem(key)).toBe("0");
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    expect(isScrollSnapshotFrozen("/skills", "editor")).toBe(true);
    expect(window.sessionStorage.getItem(key)).toBe("0");
    writeStoredScrollPosition("/skills", "editor", 500);
    expect(window.sessionStorage.getItem(key)).toBe("0");
    first.unmount();

    open("/skills", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);
  });

  it("freezes the existing latest-user position on toolbar-style pagehide without resampling geometry", () => {
    const key = scrollKey("/skills", "editor");
    open("/skills", { resume });
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 700;
      window.dispatchEvent(new Event("scroll"));
    });
    scrollOwner().scrollTop = 920; // A layout/native change is not a new user position.
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));
    expect(isScrollSnapshotFrozen("/skills", "editor")).toBe(true);
    expect(window.sessionStorage.getItem(key)).toBe("700");
    freezeExistingScrollSnapshot("/skills", "editor", "beforeunload");
    writeStoredScrollPosition("/skills", "editor", 920);
    expect(window.sessionStorage.getItem(key)).toBe("700");
  });

  it("reopens scroll saving when a pagehide document is restored from the back-forward cache", () => {
    const key = scrollKey("/skills", "editor");
    open("/skills", { resume });
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 700;
      window.dispatchEvent(new Event("scroll"));
    });
    window.dispatchEvent(new Event("pagehide"));
    expect(isScrollSnapshotFrozen("/skills", "editor")).toBe(true);

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);
    expect(isScrollSnapshotFrozen("/skills", "editor")).toBe(false);
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 860;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(window.sessionStorage.getItem(key)).toBe("860");
  });

  it("freezes and restores the Preview owner's coordinate independently from document scroll", () => {
    const key = scrollKey("/skills", "preview");
    window.sessionStorage.setItem(`${uiKey}preview-mode:skills`, "preview");
    const first = open("/skills", { resume });
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(preview, "clientHeight", { configurable: true, value: 600 });
    act(() => {
      preview.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      preview.scrollTop = 500;
      preview.dispatchEvent(new Event("scroll"));
    });
    expect(window.sessionStorage.getItem(key)).toBe("500");

    fireEvent.keyDown(window, { key: "r", metaKey: true });
    expect(isScrollSnapshotFrozen("/skills", "preview")).toBe(true);
    preview.scrollTop = 720;
    preview.dispatchEvent(new Event("scroll"));
    writeStoredScrollPosition("/skills", "preview", 720);
    expect(window.sessionStorage.getItem(key)).toBe("500");
    expect(scrollOwner().scrollTop).toBe(0);
    first.unmount();

    const next = open("/skills", { resume }, true);
    const restoredPreview = screen.getByTestId("resume-preview") as HTMLElement;
    Object.defineProperty(restoredPreview, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(restoredPreview, "clientHeight", { configurable: true, value: 600 });
    MockResizeObserver.notify();
    expect(restoredPreview.scrollTop).toBe(500);
    expect(scrollOwner().scrollTop).toBe(0);
    next.unmount();
  });

  it("allows a new exact snapshot after the prior frozen document has reloaded", () => {
    const key = scrollKey("/skills", "editor");
    const first = open("/skills", { resume });
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 700;
      window.dispatchEvent(new Event("scroll"));
    });
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    first.unmount();

    const second = open("/skills", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(700);
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scrollOwner().scrollTop = 860;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(window.sessionStorage.getItem(key)).toBe("860");
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(window.sessionStorage.getItem(key)).toBe("860");
    expect(isScrollSnapshotFrozen("/skills", "editor")).toBe(true);
    second.unmount();
  });

  it("waits for the browser load phase before applying custom restoration", () => {
    const key = scrollKey("/projects", "editor");
    window.sessionStorage.setItem(key, "300");
    const readyState = Object.getOwnPropertyDescriptor(Document.prototype, "readyState");
    Object.defineProperty(document, "readyState", { configurable: true, value: "loading" });
    const nativeMode = window.history.scrollRestoration;
    open("/projects", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);
    expect(window.history.scrollRestoration).toBe(nativeMode);

    Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
    window.dispatchEvent(new Event("load"));
    expect(scrollOwner().scrollTop).toBe(0);
    window.dispatchEvent(new Event("pageshow"));
    expect(scrollOwner().scrollTop).toBe(300);
    if (readyState) Object.defineProperty(document, "readyState", readyState);
  });

  it("does not let a late font-ready callback restore the previous route after normal navigation", async () => {
    const fontsReady = deferred<FontFaceSet>();
    Object.defineProperty(document, "fonts", { configurable: true, value: { status: "loading", ready: fontsReady.promise } });
    window.sessionStorage.setItem(scrollKey("/experience", "editor"), "500");
    open("/experience", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(0);

    fireEvent.click(screen.getByRole("link", { name: "Projects" }));
    expect(screen.getByTestId("current-path").textContent).toBe("/projects");
    fontsReady.resolve(document.fonts);
    await waitFor(() => expect(scrollOwner().scrollTop).toBe(0));
    expect(window.sessionStorage.getItem(scrollKey("/experience", "editor"))).toBe("500");
    Reflect.deleteProperty(document, "fonts");
  });

  it("restores Preview mode and its own scroll container without changing document scroll", async () => {
    const key = scrollKey("/skills", "preview");
    window.sessionStorage.setItem(`${uiKey}preview-mode:skills`, "preview");
    window.sessionStorage.setItem(key, "420");
    const view = open("/skills", { resume }, true);
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 300 });
    Object.defineProperty(preview, "clientHeight", { configurable: true, value: 100 });
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(preview.scrollTop).toBe(0);
    expect(scrollOwner().scrollTop).toBe(0);

    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 520 });
    MockResizeObserver.notify();
    await waitFor(() => expect(preview.scrollTop).toBe(420));
    expect(scrollOwner().scrollTop).toBe(0);
    expect(window.sessionStorage.getItem(key)).toBe("420");
    expect(window.sessionStorage.getItem(scrollKey("/skills", "editor"))).toBeNull();
    view.unmount();
  });

  it("reattaches Preview restoration to the actual scroll owner if it remounts during bootstrap", async () => {
    const key = scrollKey("/skills", "preview");
    window.sessionStorage.setItem(`${uiKey}preview-mode:skills`, "preview");
    window.sessionStorage.setItem(key, "240");
    open("/skills", { resume }, true);
    const oldPreview = screen.getByTestId("resume-preview") as HTMLElement;
    const replacement = document.createElement("div");
    replacement.dataset.testid = "replacement-preview";
    replacement.setAttribute("data-preview-scroll-owner", "");
    Object.defineProperty(replacement, "scrollHeight", { configurable: true, value: 800 });
    Object.defineProperty(replacement, "clientHeight", { configurable: true, value: 400 });
    act(() => { oldPreview.replaceWith(replacement); });
    MockResizeObserver.notify();

    await waitFor(() => expect(replacement.scrollTop).toBe(240));
    expect(scrollOwner().scrollTop).toBe(0);
    expect(window.sessionStorage.getItem(key)).toBe("240");
  });

  it("keeps route and mode positions isolated and saves a genuine user scroll back to zero", () => {
    window.sessionStorage.setItem(scrollKey("/skills", "editor"), "220");
    window.sessionStorage.setItem(scrollKey("/skills", "preview"), "510");
    window.sessionStorage.setItem(scrollKey("/experience", "editor"), "900");
    window.sessionStorage.setItem(`${uiKey}preview-mode:skills`, "preview");
    open("/skills", { resume }, true);
    const preview = screen.getByTestId("resume-preview") as HTMLElement;
    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(preview, "clientHeight", { configurable: true, value: 600 });
    MockResizeObserver.notify();
    expect(preview.scrollTop).toBe(510);
    expect(scrollOwner().scrollTop).toBe(0);
    preview.dispatchEvent(new Event("scroll"));

    fireEvent.wheel(preview);
    preview.scrollTop = 0;
    preview.dispatchEvent(new Event("scroll"));
    expect(window.sessionStorage.getItem(scrollKey("/skills", "preview"))).toBe("0");
    expect(window.sessionStorage.getItem(scrollKey("/skills", "editor"))).toBe("220");
    expect(window.sessionStorage.getItem(scrollKey("/experience", "editor"))).toBe("900");
  });

  it("does not let StrictMode replay erase an editor position or count bootstrap scroll as user input", () => {
    const key = scrollKey("/experience", "editor");
    window.sessionStorage.setItem(key, "340");
    mockDocumentReload();
    const view = render(<StrictMode><UiLocaleProvider><MemoryRouter initialEntries={["/experience"]}><PathnameProbe /><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} /></MemoryRouter></UiLocaleProvider></StrictMode>);
    expect(scrollOwner().scrollTop).toBe(340);
    scrollOwner().scrollTop = 0;
    window.dispatchEvent(new Event("scroll"));
    expect(window.sessionStorage.getItem(key)).toBe("340");
    view.unmount();
  });

  it("allows a genuine Editor scroll back to the top to replace a restored non-zero position", () => {
    const key = scrollKey("/experience", "editor");
    window.sessionStorage.setItem(key, "340");
    open("/experience", { resume }, true);
    expect(scrollOwner().scrollTop).toBe(340);
    window.dispatchEvent(new Event("scroll"));

    fireEvent.wheel(window);
    scrollOwner().scrollTop = 0;
    window.dispatchEvent(new Event("scroll"));
    expect(window.sessionStorage.getItem(key)).toBe("0");
  });

  it("does not mount the valid refresh route's loading fallback before route data is ready", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    mockDocumentReload();
    window.sessionStorage.setItem(scrollKey("/skills"), "600");
    const pending = deferred<typeof fixtureSections.skills>();
    const store = new ResumeSectionStore();
    store.setSession("verified-admin-session");
    const repository = {
      load: vi.fn(),
      loadSiteMetadata: vi.fn().mockResolvedValue({ resumeId: "refresh-resume", siteKey: "example-cv", isPublished: true, updatedAt: null }),
      loadSkills: vi.fn(() => pending.promise),
    } as unknown as ResumeRepository;
    render(<StrictMode><UiLocaleProvider><MemoryRouter initialEntries={["/skills"]}><ResumeLoader repository={repository}
      sectionStore={store} sessionKey="verified-admin-session" identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider></StrictMode>);

    expect(screen.queryByText("正在加载技能……")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector(".app-shell")).toBeNull();
    pending.resolve(fixtureSections.skills);
    expect(await screen.findByRole("heading", { name: "技能", level: 1 })).toBeTruthy();
    expect(screen.queryByText("正在加载技能……")).toBeNull();
    expect(scrollOwner().scrollTop).toBe(600);
    expect(window.sessionStorage.getItem(scrollKey("/skills"))).toBe("600");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

class MockResizeObserver {
  private static callbacks = new Set<() => void>();
  private readonly notifyCallback: () => void;
  constructor(callback: ResizeObserverCallback) {
    this.notifyCallback = () => callback([], this);
    MockResizeObserver.callbacks.add(this.notifyCallback);
  }
  observe() {}
  unobserve() {}
  disconnect() { MockResizeObserver.callbacks.delete(this.notifyCallback); }
  static notify() { for (const callback of [...MockResizeObserver.callbacks]) callback(); }
  static reset() { MockResizeObserver.callbacks.clear(); }
  static count() { return MockResizeObserver.callbacks.size; }
}
