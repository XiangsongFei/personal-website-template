import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { shouldStackPairedValues, textControlHorizontalChrome, measureTextControlWidth, type MeasurableTextControl } from "./pairedBilingualFit";

type Props = {
  className: string;
  values: readonly string[];
  adaptive: boolean;
  anchor: string;
  children: ReactNode;
  as?: "div" | "section";
  measureText?: (input: MeasurableTextControl) => number | null;
};

export function AdaptivePairedField({ className, values, adaptive, anchor, children, as: wrapperTag = "section", measureText = measureTextControlWidth }: Props) {
  const pairRef = useRef<HTMLElement>(null);
  const [stacked, setStacked] = useState(false);
  const valueSignature = values.join("\u0000");

  useLayoutEffect(() => {
    const pair = pairRef.current;
    const valueArea = pair?.querySelector<HTMLElement>(".bilingual-field-values");
    if (!adaptive || !pair || !valueArea) {
      setStacked(false);
      return;
    }

    const measure = () => {
      const areaStyle = window.getComputedStyle(valueArea);
      const gap = Number.parseFloat(areaStyle.columnGap);
      const rect = valueArea.getBoundingClientRect();
      const areaWidth = rect.width
        - (Number.parseFloat(areaStyle.paddingLeft) || 0)
        - (Number.parseFloat(areaStyle.paddingRight) || 0)
        - (Number.parseFloat(areaStyle.borderLeftWidth) || 0)
        - (Number.parseFloat(areaStyle.borderRightWidth) || 0);
      // Ignore transient zero/partial layout instead of classifying it as overflow.
      if (!Number.isFinite(areaWidth) || areaWidth <= 0 || !Number.isFinite(gap)) return;
      const pairedColumnWidth = (areaWidth - gap) / 2;
      const controls = Array.from(valueArea.querySelectorAll<MeasurableTextControl>("input, textarea"));
      if (controls.length !== 2) {
        setStacked(true);
        return;
      }
      const fits = controls.map(input => {
        const textWidth = measureText(input);
        return textWidth === null ? null : { textWidth, horizontalChrome: textControlHorizontalChrome(input) };
      });
      // Missing font metrics are also an unready measurement; preserve the current layout.
      if (fits.some(value => value === null)) return;
      const nextStacked = shouldStackPairedValues(stacked, fits as NonNullable<(typeof fits)[number]>[], pairedColumnWidth);
      if (nextStacked !== null) setStacked(nextStacked);
    };

    let active = true;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(valueArea);
    const fonts = document.fonts;
    fonts?.addEventListener?.("loadingdone", measure);
    if (fonts?.ready && typeof fonts.ready.then === "function") {
      void fonts.ready.then(() => { if (active) measure(); });
    }
    return () => {
      active = false;
      observer?.disconnect();
      fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [adaptive, valueSignature, measureText, stacked]);

  const wrapperClass = `${className}${stacked ? " is-adaptive-stacked" : ""}`;
  const setPairRef = (node: HTMLElement | null) => { pairRef.current = node; };
  return wrapperTag === "div"
    ? <div ref={setPairRef} className={wrapperClass} data-editor-anchor={anchor}>{children}</div>
    : <section ref={setPairRef} className={wrapperClass} data-editor-anchor={anchor}>{children}</section>;
}
