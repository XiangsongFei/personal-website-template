import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function open(path = "/introduction") {
  return render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider>);
}

describe("Introduction responsive editor layout", () => {
  it("keeps order-based Introduction labels, Add paragraph, and actions inside its scoped editor", () => {
    open();
    const scope = document.querySelector(".introduction-editor-scope") as HTMLElement;
    expect(scope).toBeTruthy();
    const group = scope.querySelector('.repeatable-group[aria-label="Introduction"]') as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.querySelector(".group-heading")?.contains(screen.getByRole("button", { name: "Add paragraph" }))).toBe(true);
    fireEvent.change(screen.getByLabelText("English Paragraph"), { target: { value: "A very long introduction paragraph that must never push the action controls outside the editor column." } });
    const cardHeading = scope.querySelector(".item-card-heading") as HTMLElement;
    expect(cardHeading.querySelector("h3")?.textContent).toBe("Introduction 1");
    expect(cardHeading.querySelector(".item-actions")).toBeTruthy();
    expect(cardHeading.querySelector("h3")?.parentElement).not.toBe(cardHeading.querySelector(".item-actions"));
    expect(within(cardHeading).getByRole("button", { name: /Close editor for/ })).toBeTruthy();
    expect(within(cardHeading).getByRole("button", { name: /Move .* down/ })).toBeTruthy();
    expect(within(cardHeading).getByRole("button", { name: "Delete Introduction 1" })).toBeTruthy();
  });

  it("uses container-scoped width constraints and stacks paired textareas when the editor column is narrow", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".introduction-editor-scope{width:100%;min-width:0;container-type:inline-size}");
    expect(css).toContain(".introduction-editor-scope .item-card-heading{display:flex;flex-direction:row;align-items:center;width:100%;min-width:0}");
    expect(css).toContain(".introduction-editor-scope .item-actions{flex:0 0 auto;flex-wrap:nowrap;white-space:nowrap}");
    expect(css).toContain(".introduction-editor-scope .field textarea{width:100%;min-width:0;max-width:100%}");
    expect(css).toMatch(/\.introduction-editor-scope \.bilingual-grid\.has-locale-headings\{grid-template-columns:minmax\(0,1fr\);gap:0\}/);
    expect(css).toMatch(/\.introduction-editor-scope \.bilingual-column-headings\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    expect(css).toContain(".introduction-editor-scope .bilingual-column-headings>span:first-child{display:none}");
    expect(css).toContain(".introduction-editor-scope .bilingual-field-pair>h3{display:none}");
    expect(css).toContain(".introduction-editor-scope .bilingual-field-values .field label>span[aria-hidden=true]{display:none}");
    expect(css).toContain(".introduction-editor-scope .item-card-body{border-top:0;padding:12px 0 20px}");
    expect(css).toContain(".introduction-editor-scope .item-card{border:0}");
    expect(css).toContain(".introduction-editor-scope .item-card + .item-card{border-top:1px solid #eee}");
    expect(css).toContain(".introduction-editor-scope .item-card:last-child{border-bottom:0}");
    expect(css).toContain(".introduction-editor-scope .bilingual-column-headings{border-bottom:0}");
    expect(css).toContain(".introduction-editor-scope .save-bar{border-top:0}");
    expect(css).toContain(":focus-visible{outline:2px solid #77766f;outline-offset:2px}");
    expect(css).toContain(".introduction-editor-scope .item-actions button:focus:not(:focus-visible){outline:none}");
    expect(css).toMatch(/@container\s*\(max-width:\s*560px\)\s*\{[^}]*\.introduction-editor-scope \.bilingual-column-headings\{display:none\}[^}]*\.introduction-editor-scope \.bilingual-field-values\{grid-template-columns:minmax\(0,1fr\);gap:16px\}[^}]*\.introduction-editor-scope \.bilingual-field-values \.field label>span\[aria-hidden=true\]\{display:inline\}/);
  });

  it("keeps the Introduction heading and ordered labels while preserving paired bilingual values", () => {
    open();
    const scope = document.querySelector(".introduction-editor-scope") as HTMLElement;
    expect(within(scope).getByRole("heading", { level: 2, name: "Introduction" })).toBeTruthy();
    const expanded = scope.querySelector(".item-card-body") as HTMLElement;
    expect(expanded.querySelectorAll(".bilingual-column-headings")).toHaveLength(1);
    expect(within(expanded).getByText("Chinese", { selector: ".bilingual-column-headings [lang='zh']" })).toBeTruthy();
    expect(within(expanded).getByText("English", { selector: ".bilingual-column-headings [lang='en']" })).toBeTruthy();
    expect(within(expanded).getByLabelText("Chinese Paragraph")).toBeTruthy();
    expect(within(expanded).getByLabelText("English Paragraph")).toBeTruthy();
    const cards = Array.from(scope.querySelectorAll<HTMLElement>(".item-card"));
    expect(cards).toHaveLength(2);
    expect(cards.map(card => card.querySelector(".item-number")?.textContent)).toEqual(["01", "02"]);
    expect(cards.map(card => card.querySelector(".item-card-heading h3")?.textContent)).toEqual(["Introduction 1", "Introduction 2"]);
    expect((within(expanded).getByLabelText("Chinese Paragraph") as HTMLTextAreaElement).value).toBe("这是一个双语个人网站模板。");
    expect((within(expanded).getByLabelText("English Paragraph") as HTMLTextAreaElement).value).toBe("This is a bilingual portfolio template.");
    expect(scope.querySelector(".page-heading > p:last-child")?.textContent).toBe("Edit the Chinese and English introduction side by side.");
    expect(within(scope).getAllByRole("button", { name: "Save Introduction changes" })).toHaveLength(1);
    expect(within(scope).getAllByRole("button", { name: "Cancel changes" })).toHaveLength(1);
    expect(within(scope).queryByRole("button", { name: /Save (Chinese|English)/ })).toBeNull();
    expect(scope.textContent).not.toMatch(/Save production changes|Save to production|保存到生产环境|written to production/i);
  });

  it("shows the localized section heading, add action, and save action in Chinese UI", () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    open();
    const scope = document.querySelector(".introduction-editor-scope") as HTMLElement;
    expect(within(scope).getByRole("heading", { name: "简介内容" })).toBeTruthy();
    expect(within(scope).getByRole("heading", { level: 1, name: "个人简介" })).toBeTruthy();
    expect(scope.querySelector(".page-heading > p:last-child")?.textContent).toBe("左右对照编辑中文和英文简介。");
    expect(within(scope).getByRole("button", { name: "添加段落" })).toBeTruthy();
    expect(within(scope).getByRole("button", { name: "保存个人简介修改" })).toBeTruthy();
    expect(within(scope).queryByRole("heading", { name: "Introduction" })).toBeNull();
    expect(Array.from(scope.querySelectorAll<HTMLElement>(".item-card-heading h3")).map(heading => heading.textContent)).toEqual(["简介段落 1", "简介段落 2"]);
    const expanded = scope.querySelector(".item-card-body") as HTMLElement;
    expect(within(expanded).getByText("中文", { selector: ".bilingual-column-headings [lang='zh']" })).toBeTruthy();
    expect(within(expanded).getByText("English", { selector: ".bilingual-column-headings [lang='en']" })).toBeTruthy();
  });

  it("expands and collapses each Introduction item independently", () => {
    open();
    expect(document.getElementById("intro-1-zh-text")).toBeTruthy();
    expect(document.getElementById("intro-2-zh-text")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit Introduction 2" }));
    expect(document.getElementById("intro-1-zh-text")).toBeTruthy();
    expect(document.getElementById("intro-2-zh-text")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close editor for Introduction 1" }));
    expect(document.getElementById("intro-1-zh-text")).toBeNull();
    expect(document.getElementById("intro-2-zh-text")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit Introduction 1" }));
    expect(document.getElementById("intro-1-zh-text")).toBeTruthy();
    expect(document.getElementById("intro-2-zh-text")).toBeTruthy();
  });

  it("keeps expansion attached to stable item identity when Introduction items are reordered", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Move Introduction 1 down" }));

    expect(document.getElementById("intro-1-zh-text")).toBeTruthy();
    expect(document.getElementById("intro-2-zh-text")).toBeNull();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".introduction-editor-scope .item-card-heading h3")).map(heading => heading.textContent))
      .toEqual(["Introduction 1", "Introduction 2"]);
  });

  it("removes only the deleted Introduction item's expansion state", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Introduction 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Introduction 1" }));

    expect(document.getElementById("intro-1-zh-text")).toBeNull();
    expect(document.getElementById("intro-2-zh-text")).toBeTruthy();
  });

  it("keeps existing expanded items open when adding a paragraph", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add paragraph" }));

    expect(document.getElementById("intro-1-zh-text")).toBeTruthy();
    expect(document.querySelector('.introduction-editor-scope textarea[id^="local-"][id$="-zh-text"]')).toBeTruthy();
    expect(document.querySelectorAll('.introduction-editor-scope textarea[id$="-zh-text"]')).toHaveLength(2);
  });

  it("does not apply the Introduction-only width scope to another repeatable editor", () => {
    open("/experience");
    expect(document.querySelector(".introduction-editor-scope")).toBeNull();
  });
});
