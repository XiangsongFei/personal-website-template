import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function open(path = "/introduction") {
  return render(<MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter>);
}

describe("Introduction responsive editor layout", () => {
  it("keeps the Introduction list, Add item control, summary, and actions inside its scoped editor", () => {
    open();
    const scope = document.querySelector(".introduction-editor-scope") as HTMLElement;
    expect(scope).toBeTruthy();
    const group = scope.querySelector('.repeatable-group[aria-label="Introduction items"]') as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.querySelector(".group-heading")?.contains(screen.getByRole("button", { name: "Add item" }))).toBe(true);
    fireEvent.change(screen.getByLabelText("English Paragraph"), { target: { value: "A very long introduction paragraph that must never push the action controls outside the editor column." } });
    const cardHeading = scope.querySelector(".item-card-heading") as HTMLElement;
    expect(cardHeading.querySelector("h3")?.textContent).toContain("A very long introduction paragraph");
    expect(cardHeading.querySelector(".item-actions")).toBeTruthy();
    expect(cardHeading.querySelector("h3")?.parentElement).not.toBe(cardHeading.querySelector(".item-actions"));
    expect(within(cardHeading).getByRole("button", { name: /Close editor for/ })).toBeTruthy();
    expect(within(cardHeading).getByRole("button", { name: /Move .* down/ })).toBeTruthy();
    expect(within(cardHeading).getByRole("button", { name: "Delete A very long introduction paragraph that must never push the action controls outside the editor column." })).toBeTruthy();
  });

  it("uses container-scoped width constraints and stacks paired textareas when the editor column is narrow", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".introduction-editor-scope{width:100%;min-width:0;container-type:inline-size}");
    expect(css).toContain(".introduction-editor-scope .item-card-heading{display:flex;flex-direction:row;align-items:center;width:100%;min-width:0}");
    expect(css).toContain(".introduction-editor-scope .item-actions{flex:0 0 auto;flex-wrap:nowrap;white-space:nowrap}");
    expect(css).toContain(".introduction-editor-scope .field textarea{width:100%;min-width:0;max-width:100%}");
    expect(css).toMatch(/@container\s*\(max-width:\s*560px\)\s*\{[^}]*\.introduction-editor-scope \.bilingual-field-values\{grid-template-columns:minmax\(0,1fr\);gap:16px\}/);
  });

  it("does not apply the Introduction-only width scope to another repeatable editor", () => {
    open("/experience");
    expect(document.querySelector(".introduction-editor-scope")).toBeNull();
  });
});
