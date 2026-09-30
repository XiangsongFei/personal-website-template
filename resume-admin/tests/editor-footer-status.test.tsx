import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import type { LoadedResume } from "../src/data/resumeMapper";
import { fixtureSections } from "../src/fixtures";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(UI_LOCALE_KEY);
  window.sessionStorage.clear();
});

function renderFixture(path: string, locale: "en" | "zh") {
  window.localStorage.setItem(UI_LOCALE_KEY, locale);
  return render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}>
    <App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" />
  </MemoryRouter></UiLocaleProvider>);
}

describe("shared Admin editor footer status presentation", () => {
  it.each([
    { locale: "en" as const, clean: "No unsaved changes", dirty: "Unsaved changes", reverted: "Local changes reverted." },
    { locale: "zh" as const, clean: "没有未保存修改", dirty: "有未保存修改", reverted: "本地修改已撤销。" },
  ])("composes $locale Cancel feedback with the clean state on one status line", async ({ locale, clean, dirty, reverted }) => {
    renderFixture("/introduction", locale);
    await screen.findByRole("heading", { name: locale === "zh" ? "个人简介" : "Introduction", level: 1 });
    const status = document.querySelector<HTMLElement>(".editor-footer-state")!;
    expect(status.textContent).toBe(clean);
    const paragraph = document.querySelector<HTMLTextAreaElement>(".editor-content-scroll textarea")!;
    fireEvent.change(paragraph, { target: { value: "Changed draft" } });
    expect(status.textContent).toBe(dirty);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".save-bar .button.secondary")!);
    expect(status.textContent).toBe(`${clean} · ${reverted}`);
    expect(status.getAttribute("role")).toBe("status");
    expect(document.querySelector(".editor-action-footer > .save-notice")).toBeNull();
  });

  it("keeps the production-write-unavailable fallback warning and refuses the save", async () => {
    const resume = { resumeId: "footer-test-resume", siteKey: "example-cv", isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) } as LoadedResume;
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/introduction"]}>
      <App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} />
    </MemoryRouter></UiLocaleProvider>);
    await screen.findByRole("heading", { name: "Introduction", level: 1 });
    expect(Array.from(document.querySelectorAll(".save-notice")).some(notice => notice.textContent === "Local draft only. Production writes are disabled for this section.")).toBe(true);
    fireEvent.change(document.querySelector<HTMLTextAreaElement>(".editor-content-scroll textarea")!, { target: { value: "Changed draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Introduction changes" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Production writes are unavailable for this section.");
    expect(document.querySelector(".editor-footer-state")?.textContent).toBe("Unsaved changes");
  });
});
