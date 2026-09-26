import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider } from "../src/uiLocale";
import { bilingualFieldKey, collectChangedBilingualFieldKeys } from "../src/bilingualReview";

function showRoute(path: string) {
  return render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}>
    <App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" />
  </MemoryRouter></UiLocaleProvider>);
}
const showExperience = () => showRoute("/experience");

const firstExperienceId = fixtureSections.experience[0].id;
const field = (locale: "zh" | "en", key: "organization" | "title" | "period" | "description") =>
  document.getElementById(`${firstExperienceId}-${locale}-${key}`)!;
const localeWarning = (locale: "zh" | "en") => {
  const group = screen.getByRole("group", { name: "CMS interface language" });
  const button = within(group).getByRole("button", { name: locale === "zh" ? "中文" : "English" });
  return button.querySelector(".locale-review-dot");
};
function setPreviewLocale(locale: "zh" | "en") {
  const preview = screen.getByTestId("resume-preview");
  if (preview.getAttribute("lang") !== locale) fireEvent.click(within(preview).getByRole("button", { name: "Preview language" }));
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); });

describe("bilingual review and modified content", () => {
  it("keeps field identities scoped to stable repeatable item IDs", () => {
    const baseline = [
      { id: "row-a", sourceKey: "public-a", translations: { zh: { title: "A" }, en: { title: "A" } } },
      { id: "row-b", sourceKey: "public-b", translations: { zh: { title: "B" }, en: { title: "B" } } },
    ];
    const draft = structuredClone(baseline);
    draft[0].translations.zh.title = "A edited";
    const keys = collectChangedBilingualFieldKeys("experience", draft, baseline);
    expect(keys).toEqual(new Set([bilingualFieldKey({ section: "experience", itemId: "public-a", field: "title" }, "zh")]));
    expect(keys.has(bilingualFieldKey({ section: "experience", itemId: "public-b", field: "title" }, "zh"))).toBe(false);
  });

  it("marks only the edited locale field and reminds the paired locale", () => {
    showExperience();
    const before = String((field("zh", "title") as HTMLInputElement).value);
    fireEvent.change(field("zh", "title"), { target: { value: `${before} updated` } });
    const pair = screen.getByText("Role", { selector: "h3" }).parentElement!;
    expect(within(pair).getByText("Modified")).toBeTruthy();
    expect(within(pair).getByText("Review English").classList.contains("field-review-warning")).toBe(true);
    expect(within(pair).getByRole("button", { name: "No change needed" }).classList.contains("field-review-dismiss")).toBe(true);
    expect(screen.getAllByText("Modified")).toHaveLength(1);
  });

  it("keeps Profile Chinese and English review pairings stable in the side-by-side content area", () => {
    showRoute("/profile");
    const namePair = screen.getByText("Name", { selector: ".bilingual-field-pair h3" }).parentElement!;
    const zhName = document.getElementById("profile-zh-name") as HTMLInputElement;
    const enName = document.getElementById("profile-en-name") as HTMLInputElement;
    fireEvent.change(zhName, { target: { value: `${zhName.value} updated` } });
    expect(within(namePair).getByText("Review English")).toBeTruthy();
    fireEvent.click(within(namePair).getByRole("button", { name: "No change needed" }));
    expect(within(namePair).queryByText("Review English")).toBeNull();
    fireEvent.change(enName, { target: { value: `${enName.value} checked` } });
    expect(within(namePair).getByText("Review Chinese")).toBeTruthy();
  });

  it.each(["zh", "en"] as const)("keeps Introduction review state symmetric for a %s edit", locale => {
    showRoute("/introduction");
    const sourceLocale = locale === "zh" ? "Chinese" : "English";
    const targetLocale = locale === "zh" ? "en" : "zh";
    const targetLabel = targetLocale === "zh" ? "Chinese Paragraph" : "English Paragraph";
    const source = screen.getByLabelText(`${sourceLocale} Paragraph`) as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: `${source.value} edited` } });

    expect(source.closest(".field")?.querySelector(".field-edit-status")?.textContent).toContain("Modified");
    const target = screen.getByLabelText(targetLabel);
    const targetField = target.closest(".field") as HTMLElement;
    expect(targetField.querySelector(".field-review-warning")?.textContent).toBe(targetLocale === "zh" ? "Review Chinese" : "Review English");
    expect(localeWarning(targetLocale)).toBeTruthy();
    expect(localeWarning(locale)).toBeNull();

    fireEvent.click(within(targetField).getByRole("button", { name: "No change needed" }));
    expect(targetField.querySelector(".field-review-warning")).toBeNull();
    expect(localeWarning("zh")).toBeNull();
    expect(localeWarning("en")).toBeNull();
  });

  it.each(["zh", "en"] as const)("shows and clears the locale warning symmetrically for a %s source edit", locale => {
    showExperience();
    const source = field(locale, "title");
    const sourceValue = (source as HTMLInputElement).value;
    fireEvent.change(source, { target: { value: `${sourceValue} changed` } });
    const target: "zh" | "en" = locale === "zh" ? "en" : "zh";
    const pair = screen.getByText("Role", { selector: "h3" }).parentElement!;
    expect(pair.querySelector(".field-review-warning")).toBeTruthy();
    expect(within(pair).getByText("Modified")).toBeTruthy();
    expect(localeWarning(target)).toBeTruthy();
    expect(localeWarning(locale)).toBeNull();

    // Locale-level warnings belong to the review target, even when that locale is active.
    fireEvent.click(within(screen.getByRole("group", { name: "CMS interface language" }))
      .getByRole("button", { name: target === "zh" ? "中文" : "English" }));
    expect(localeWarning(target)).toBeTruthy();
    expect(localeWarning(locale)).toBeNull();

    fireEvent.click(within(pair).getByRole("button", { name: /No change needed|无需修改/ }));
    expect(pair.querySelector(".field-review-warning")).toBeNull();
    expect(localeWarning("zh")).toBeNull();
    expect(localeWarning("en")).toBeNull();
  });

  it("clears a reminder when the counterpart is edited or explicitly confirmed", () => {
    showExperience();
    const zh = field("zh", "title");
    fireEvent.change(zh, { target: { value: `${(zh as HTMLInputElement).value} updated` } });
    const en = field("en", "title");
    fireEvent.change(en, { target: { value: `${(en as HTMLInputElement).value} checked` } });
    expect(screen.queryByText("Review English")).toBeNull();
    expect(screen.queryByText("Review Chinese")).toBeNull();

    fireEvent.change(zh, { target: { value: `${(zh as HTMLInputElement).value} again` } });
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));
    expect(screen.queryByText("Review English")).toBeNull();
  });

  it("removes modified state and its unsaved reminder when reverted or cancelled", () => {
    showExperience();
    const zh = field("zh", "title");
    const original = (zh as HTMLInputElement).value;
    fireEvent.change(zh, { target: { value: `${original} changed` } });
    fireEvent.change(zh, { target: { value: original } });
    expect(screen.queryByText("Modified")).toBeNull();
    expect(screen.queryByText("Review English")).toBeNull();

    fireEvent.change(zh, { target: { value: `${original} changed again` } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(screen.queryByText("Modified")).toBeNull();
    expect(screen.queryByText("Review English")).toBeNull();
  });

  it("keeps an outstanding counterpart reminder after saving the source locale", async () => {
    showExperience();
    const en = field("en", "title");
    fireEvent.change(en, { target: { value: `${(en as HTMLInputElement).value} saved` } });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    expect(await screen.findByText("Review Chinese")).toBeTruthy();
    expect(screen.queryByText("Modified")).toBeNull();
    expect(localeWarning("zh")).toBeTruthy();
    expect(localeWarning("en")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));
    expect(localeWarning("zh")).toBeNull();
  });

  it("highlights the changed Preview field without highlighting its unchanged sibling fields or another entry", () => {
    showExperience();
    const changedTitle = field("zh", "title");
    fireEvent.change(changedTitle, { target: { value: `${(changedTitle as HTMLInputElement).value} preview` } });
    setPreviewLocale("zh");
    const preview = screen.getByTestId("resume-preview");
    const firstJob = preview.querySelector("#preview-experience .resume-preview-timeline article")!;
    expect(firstJob.querySelector(".resume-preview-job-title > .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("true");
    expect(firstJob.querySelector("h3 > .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("false");
    expect(firstJob.querySelector(".resume-preview-entry-meta strong > .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("false");
  });

  it("anchors the Hero highlight to the title text instead of the full heading box", () => {
    showRoute("/profile");
    setPreviewLocale("zh");
    fireEvent.change(screen.getByLabelText("Chinese Name"), { target: { value: "短名字" } });
    const title = screen.getByTestId("resume-preview").querySelector(".resume-preview-hero h1")!;
    expect(title.hasAttribute("data-preview-modified")).toBe(false);
    expect(title.querySelector(":scope > .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("true");
    expect(title.textContent).toBe("短名字");
  });

  it("uses inline text fragments for a wrappable Introduction paragraph", () => {
    showRoute("/introduction");
    const paragraph = "A changed paragraph that wraps naturally in the preview. ".repeat(12);
    fireEvent.change(screen.getByLabelText("English Paragraph"), { target: { value: paragraph } });
    const previewParagraph = screen.getByTestId("resume-preview").querySelector(".resume-preview-intro p")!;
    expect(previewParagraph.hasAttribute("data-preview-modified")).toBe(false);
    expect(previewParagraph.querySelector(":scope > .resume-preview-marked-text")?.getAttribute("data-preview-modified")).toBe("true");
    expect(previewParagraph.textContent).toBe(paragraph);
    const css = readFileSync("src/preview/preview.css", "utf8");
    expect(css).toContain("box-decoration-break:clone");
    expect(css).toContain("background-color:rgba(245,183,66,.42)");
    expect(css).not.toContain("box-shadow:inset 0 0 0 1px rgba(184,104,30,.72)");
    expect(css).not.toContain("box-shadow:inset 0 -1px 0");
    expect(css).not.toContain("linear-gradient(to bottom,transparent 58%");
  });
});
