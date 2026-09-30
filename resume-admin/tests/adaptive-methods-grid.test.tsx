import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptiveMethodsGrid } from "../src/AdaptiveMethodsGrid";
import type { MeasurableTextControl } from "../src/pairedBilingualFit";

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; MockResizeObserver.instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() {}
  notify() { this.callback([], this as unknown as ResizeObserver); }
}

type Lists = { zh: string[]; en: string[] };

function MethodListHarness({ measureText }: {
  measureText: (control: MeasurableTextControl) => number | null;
  actionWidth?: number;
}) {
  const [lists, setLists] = useState<Lists>({ zh: ["数据整理", "指标分析"], en: ["Data preparation", "Metric analysis"] });
  return <AdaptiveMethodsGrid values={[lists.zh, lists.en]} measureText={measureText}>
    {(["zh", "en"] as const).map(locale => <section className="method-group" data-locale={locale} key={locale}>
      <div className="group-heading"><h4>{locale === "zh" ? "Chinese" : "English"}</h4><button type="button">{locale === "zh" ? "Add Chinese method" : "Add English method"}</button></div>
      {lists[locale].map((value, index) => <div className="method-row" key={`${locale}-${index}`}>
        <div className="field"><label><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span>{locale} method {index + 1}</span></label>
          <input aria-label={`${locale} method ${index + 1}`} value={value} onChange={event => setLists(current => ({ ...current, [locale]: current[locale].map((entry, row) => row === index ? event.target.value : entry) }))} />
        </div>
        <div className="method-actions"><button type="button" aria-label={`Move ${locale} method ${index + 1} up`}>↑</button><button type="button" aria-label={`Delete ${locale} method ${index + 1}`}>Delete</button></div>
      </div>)}
    </section>)}
  </AdaptiveMethodsGrid>;
}

describe("Projects Methods list-level adaptive layout", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    MockResizeObserver.instances = [];
  });

  function setup({ width = 700, actionWidth = 100, measureText = () => 40 }: {
    width?: number; actionWidth?: number; measureText?: (control: MeasurableTextControl) => number | null;
  } = {}) {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    let gridWidth = width;
    const originalGetStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
      const original = originalGetStyle(element);
      const overrides: Partial<CSSStyleDeclaration> = element instanceof HTMLElement
        ? element.classList.contains("methods-grid") ? { columnGap: "20px" }
          : element.classList.contains("group-heading") ? { columnGap: "12px" }
            : element.classList.contains("method-row") ? { columnGap: "8px" }
              : element.classList.contains("field") ? { columnGap: "8px" }
                : {} : {};
      return new Proxy(original, { get: (target, property) => property in overrides ? overrides[property as keyof CSSStyleDeclaration] : Reflect.get(target, property) }) as CSSStyleDeclaration;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      let rectWidth = 0;
      if (this.classList.contains("methods-grid")) rectWidth = gridWidth;
      else if (this.tagName === "H4") rectWidth = 50;
      else if (this.classList.contains("group-heading") && this.querySelector("h4")?.textContent === "Chinese") rectWidth = 100;
      else if (this.classList.contains("method-actions")) rectWidth = actionWidth;
      else if (this.tagName === "LABEL") rectWidth = 30;
      return { x: 0, y: 0, left: 0, top: 0, right: rectWidth, bottom: 20, width: rectWidth, height: 20, toJSON() {} } as DOMRect;
    });
    const result = render(<MethodListHarness measureText={measureText} />);
    const grid = result.container.querySelector(".methods-grid")!;
    return { ...result, grid, resize: (next: number) => { gridWidth = next; act(() => MockResizeObserver.instances.at(-1)?.notify()); } };
  }

  it("pairs the complete short Chinese and English lists while retaining locale grouping and numbering", () => {
    const { grid } = setup();
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(false);
    expect(Array.from(grid.querySelectorAll<HTMLElement>(".method-group"), group => group.dataset.locale)).toEqual(["zh", "en"]);
    expect(Array.from(grid.querySelectorAll<HTMLElement>(".method-group"), group => Array.from(group.querySelectorAll(".method-row"), row => row.querySelector("label span[aria-hidden=true]")?.textContent))).toEqual([["01", "02"], ["01", "02"]]);
    expect(grid.querySelectorAll(".method-row.is-adaptive-stacked")).toHaveLength(0);
  });

  it.each(["zh", "en"] as const)("stacks both locale lists when any %s method value is too long", locale => {
    const { grid } = setup({ measureText: control => control.value.includes("LONG") ? 240 : 40 });
    fireEvent.change(screen.getByLabelText(`${locale} method 1`), { target: { value: "LONG method text" } });
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(true);
    expect(grid.querySelectorAll(".method-group")).toHaveLength(2);
    expect(grid.querySelectorAll(".method-row.is-adaptive-stacked")).toHaveLength(0);
  });

  it("returns the whole pair to side-by-side after a long value is shortened", () => {
    const { grid } = setup({ measureText: control => control.value.includes("LONG") ? 240 : 40 });
    const input = screen.getByLabelText("zh method 1");
    fireEvent.change(input, { target: { value: "LONG method text" } });
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(true);
    fireEvent.change(input, { target: { value: "整理" } });
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(false);
  });

  it("re-evaluates the whole list pair wide → narrow → wide", () => {
    const { grid, resize } = setup({ width: 900 });
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(false);
    resize(450);
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(true);
    resize(900);
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(false);
  });

  it("reserves row number, action controls, and the locale add control before pairing", () => {
    const { grid } = setup({ actionWidth: 190 });
    expect(grid.classList.contains("is-adaptive-stacked")).toBe(true);
    expect(screen.getByRole("button", { name: "Add Chinese method" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add English method" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move zh method 1 up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete en method 2" })).toBeTruthy();
  });
});
