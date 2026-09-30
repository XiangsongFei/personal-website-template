import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptivePairedField } from "../src/AdaptivePairedField";
import { MIN_USABLE_PAIRED_LOCALE_TRACK_WIDTH, shouldStackPairedValues, type MeasurableTextControl } from "../src/pairedBilingualFit";

const metric = (textWidth: number) => ({ textWidth, horizontalChrome: 0 });

describe("paired bilingual fit decisions", () => {
  it("keeps both values paired when both fit with the safety inset", () => {
    expect(shouldStackPairedValues(false, [metric(70), metric(80)], 130)).toBe(false);
  });

  it("stacks when Chinese does not fit", () => {
    expect(shouldStackPairedValues(false, [metric(123), metric(40)], 130)).toBe(true);
  });

  it("stacks when English does not fit", () => {
    expect(shouldStackPairedValues(false, [metric(40), metric(123)], 130)).toBe(true);
  });

  it("stacks when both values do not fit", () => {
    expect(shouldStackPairedValues(false, [metric(127), metric(131)], 130)).toBe(true);
  });

  it("treats an empty locale as fitting when the other value fits", () => {
    expect(shouldStackPairedValues(false, [metric(0), metric(80)], 130)).toBe(false);
  });

  it("stacks for an empty locale when the other value does not fit", () => {
    expect(shouldStackPairedValues(false, [metric(0), metric(123)], 130)).toBe(true);
  });

  it("transitions from paired to stacked as an edited value grows", () => {
    expect(shouldStackPairedValues(false, [metric(40), metric(40)], 130)).toBe(false);
    expect(shouldStackPairedValues(false, [metric(123), metric(40)], 130)).toBe(true);
  });

  it("transitions from stacked to paired only after both values have recovery room", () => {
    expect(shouldStackPairedValues(true, [metric(40), metric(40)], 130)).toBe(false);
    expect(shouldStackPairedValues(true, [metric(115), metric(40)], 130)).toBe(true);
  });

  it("stacks as the candidate paired width narrows", () => {
    expect(shouldStackPairedValues(false, [metric(70), metric(70)], 130)).toBe(false);
    expect(shouldStackPairedValues(false, [metric(70), metric(70)], 119)).toBe(true);
  });

  it("returns to paired when the candidate width grows enough", () => {
    expect(shouldStackPairedValues(true, [metric(70), metric(70)], 119)).toBe(true);
    expect(shouldStackPairedValues(true, [metric(70), metric(70)], 130)).toBe(false);
  });

  it("stacks below the shared usable-track minimum even when both values are tiny", () => {
    expect(MIN_USABLE_PAIRED_LOCALE_TRACK_WIDTH).toBe(120);
    expect(shouldStackPairedValues(false, [metric(12), metric(20)], 119.99)).toBe(true);
  });

  it("allows the exact minimum width when values fit with the existing safety inset", () => {
    expect(shouldStackPairedValues(false, [metric(12), metric(20)], 120)).toBe(false);
  });

  it("stacks a value that overflows a usable mobile-like locale track", () => {
    expect(shouldStackPairedValues(false, [metric(141), metric(40)], 140)).toBe(true);
  });

  it("requires the existing recovery inset after a minimum-width stack", () => {
    expect(shouldStackPairedValues(true, [metric(110), metric(40)], 120)).toBe(true);
    expect(shouldStackPairedValues(true, [metric(110), metric(40)], 126)).toBe(false);
  });

  it.each([
    ["实习经历", "Internship Experience", 36, 144],
    ["示例科技公司", "Example Technology Company", 90, 168],
    ["北京，中国", "Beijing, China", 72, 110],
  ])("keeps the representative pair %s | %s paired at a valid candidate width", (_zh, _en, zhWidth, enWidth) => {
    expect(shouldStackPairedValues(false, [metric(zhWidth), metric(enWidth)], 190)).toBe(false);
  });

  it("stacks representative long Chinese and English values when either exceeds its candidate track", () => {
    expect(shouldStackPairedValues(false, [metric(225), metric(90)], 190)).toBe(true);
    expect(shouldStackPairedValues(false, [metric(90), metric(225)], 190)).toBe(true);
  });

  it("leaves invalid/zero candidate geometry undecided", () => {
    expect(shouldStackPairedValues(false, [metric(10), metric(10)], 0)).toBeNull();
    expect(shouldStackPairedValues(false, [metric(Number.NaN), metric(10)], 100)).toBeNull();
  });
});

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; MockResizeObserver.instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() {}
  notify() { this.callback([], this as unknown as ResizeObserver); }
}

function AdaptiveHarness({ measureText, adaptive = true, textarea = false }: { measureText: (input: MeasurableTextControl) => number | null; adaptive?: boolean; textarea?: boolean }) {
  const [values, setValues] = useState<[string, string]>(["北京", "Beijing"]);
  return <AdaptivePairedField className={`bilingual-field-pair${adaptive ? " paired-bilingual-single-line" : ""}`} anchor="test" adaptive={adaptive} values={values} measureText={measureText}>
    <div className="bilingual-field-values">{(["zh", "en"] as const).map((locale, index) => <div className="field" key={locale}>
      <label htmlFor={locale}>{index === 0 ? "Chinese" : "English"}</label>
      {textarea
        ? <textarea id={locale} rows={1} value={values[index]} onChange={event => setValues(index === 0 ? [event.target.value, values[1]] : [values[0], event.target.value])} />
        : <input id={locale} value={values[index]} onChange={event => setValues(index === 0 ? [event.target.value, values[1]] : [values[0], event.target.value])} />}
    </div>)}
    </div>
  </AdaptivePairedField>;
}

describe("adaptive paired field wiring", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    MockResizeObserver.instances = [];
  });

  function setup(suppliedMeasure?: (input: MeasurableTextControl) => number | null, adaptive = true, initialWidth = 360, textarea = false) {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
      const computed = original(element);
      if (element instanceof HTMLElement && element.classList.contains("bilingual-field-values")) {
        return { columnGap: "20px", paddingLeft: "0px", paddingRight: "0px" } as CSSStyleDeclaration;
      }
      return computed;
    });
    let width = initialWidth;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains("bilingual-field-values")) return { width, height: 80, top: 0, bottom: 80, left: 0, right: width, x: 0, y: 0, toJSON() {} } as DOMRect;
      return new DOMRect();
    });
    const measureText = suppliedMeasure ?? ((input: MeasurableTextControl) => input.value === "北京" || input.value === "Beijing" ? 40 : input.value.length > 8 ? 170 : 45);
    const result = render(<AdaptiveHarness measureText={measureText} adaptive={adaptive} textarea={textarea} />);
    const pair = result.container.querySelector(".paired-bilingual-single-line")!;
    return { ...result, pair, measureText, setWidth: (next: number) => { width = next; } };
  }

  it("keeps the same input nodes mounted while editing crosses the fit boundary", () => {
    const { pair } = setup();
    const input = screen.getByLabelText("Chinese") as HTMLInputElement;
    const originalNode = input;
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
    fireEvent.change(input, { target: { value: "北京非常长的中文地址示例内容" } });
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(true);
    expect(screen.getByLabelText("Chinese")).toBe(originalNode);
    fireEvent.change(originalNode, { target: { value: "北京" } });
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
    expect(screen.getByLabelText("Chinese")).toBe(originalNode);
  });

  it("adapts one-row auto-sizing textarea values without replacing the controls", () => {
    const { pair } = setup(undefined, true, 360, true);
    const nameField = pair.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(nameField.tagName).toBe("TEXTAREA");
    expect(nameField.rows).toBe(1);
    fireEvent.change(nameField, { target: { value: "这是一个足够长的奖项名称示例文本" } });
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(true);
    expect(pair.querySelector("textarea")).toBe(nameField);
    fireEvent.change(nameField, { target: { value: "奖项" } });
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
    expect(pair.querySelector("textarea")).toBe(nameField);
  });

  it("re-evaluates hypothetical paired capacity after observed width changes", () => {
    const { pair, setWidth } = setup();
    act(() => MockResizeObserver.instances.at(-1)?.notify());
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
    setWidth(250);
    act(() => MockResizeObserver.instances.at(-1)?.notify());
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(true);
    setWidth(400);
    act(() => MockResizeObserver.instances.at(-1)?.notify());
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
  });

  it("does not stack from an initial zero-width observation and recovers when layout becomes measurable", () => {
    const { pair, setWidth } = setup(undefined, true, 0);
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
    setWidth(360);
    act(() => MockResizeObserver.instances.at(-1)?.notify());
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
  });

  it("pairs short values at a mobile-like width when each candidate track is usable", () => {
    const measureText = vi.fn(() => 20);
    const { pair } = setup(measureText, true, 300);
    expect(pair.classList.contains("is-adaptive-stacked")).toBe(false);
    expect(measureText).toHaveBeenCalledTimes(2);
  });

  it("uses one all-size CSS eligibility rule without a viewport or pointer fit gate", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).not.toContain("--paired-bilingual-fit-enabled");
    const finePointerRule = css.slice(css.indexOf("@media (min-width:861px) and (pointer:fine){"), css.indexOf("/* Education-only final spacing"));
    expect(finePointerRule).not.toContain("paired-bilingual-single-line");
    const narrowRules = css.slice(css.indexOf("@container (max-width:620px){"), css.lastIndexOf("/* Only opted-in pairs use measured 1:1 fit at any screen or pointer size. */"));
    expect(narrowRules).not.toContain("--paired-bilingual-fit-enabled");
    const allSizeRules = css.slice(css.lastIndexOf("/* Only opted-in pairs use measured 1:1 fit at any screen or pointer size. */"));
    expect(allSizeRules).toContain(".education-editor-scope .paired-bilingual-single-line .bilingual-field-values,");
    expect(allSizeRules).toContain(".links-editor-scope .paired-bilingual-single-line .bilingual-field-values{grid-template-columns:repeat(2,minmax(0,1fr))}");
    expect(allSizeRules).toContain(".links-editor-scope .paired-bilingual-single-line.is-adaptive-stacked .bilingual-field-values{grid-template-columns:minmax(0,1fr)}");
    expect(allSizeRules).toContain(".paired-bilingual-single-line.is-adaptive-stacked .bilingual-field-values .field label>span[aria-hidden=true]{display:inline}");
  });

  it("does not measure or observe non-opted fields such as long-form/deferred fields", () => {
    const measureText = vi.fn(() => 20);
    setup(measureText, false);
    expect(measureText).not.toHaveBeenCalled();
    expect(MockResizeObserver.instances).toHaveLength(0);
  });
});
