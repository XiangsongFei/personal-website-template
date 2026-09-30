import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MIN_USABLE_PAIRED_LOCALE_TRACK_WIDTH, PAIRED_FIT_RECOVERY_INSET, PAIRED_FIT_STACK_INSET, measureTextControlWidth, textControlHorizontalChrome } from "./pairedBilingualFit";
import type { MeasurableTextControl } from "./pairedBilingualFit";

type Props = {
  values: readonly (readonly string[])[];
  children: ReactNode;
  measureText?: (control: MeasurableTextControl) => number | null;
};

const px = (value: string) => Number.parseFloat(value) || 0;

/** Adapts the two complete Projects method lists as one locale-level pair. */
export function AdaptiveMethodsGrid({ values, children, measureText = measureTextControlWidth }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  const valueSignature = JSON.stringify(values);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const measure = () => {
      const gridStyle = window.getComputedStyle(grid);
      const gridRect = grid.getBoundingClientRect();
      const columnGap = px(gridStyle.columnGap);
      const localeTrack = (gridRect.width - columnGap) / 2;
      if (!Number.isFinite(localeTrack) || localeTrack <= 0) return;

      const groups = Array.from(grid.querySelectorAll<HTMLElement>(".method-group"));
      if (groups.length !== 2) {
        setStacked(true);
        return;
      }

      let narrowestValueTrack = Number.POSITIVE_INFINITY;
      const textFits: number[] = [];
      let geometryReady = true;
      let layoutFits = true;

      for (const group of groups) {
        const groupStyle = window.getComputedStyle(group);
        const groupWidth = localeTrack
          - px(groupStyle.paddingLeft) - px(groupStyle.paddingRight)
          - px(groupStyle.borderLeftWidth) - px(groupStyle.borderRightWidth);
        const heading = group.querySelector<HTMLElement>(".group-heading");
        const headingTitle = heading?.querySelector<HTMLElement>("h4");
        const addButton = heading?.querySelector<HTMLElement>("button");
        if (heading && headingTitle && addButton) {
          const headingGap = px(window.getComputedStyle(heading).columnGap);
          const requiredHeadingWidth = Math.max(headingTitle.getBoundingClientRect().width, headingTitle.scrollWidth)
            + Math.max(addButton.getBoundingClientRect().width, addButton.scrollWidth) + headingGap;
          if (requiredHeadingWidth > groupWidth) layoutFits = false;
        }

        for (const row of Array.from(group.querySelectorAll<HTMLElement>(".method-row"))) {
          const field = row.querySelector<HTMLElement>(".field");
          const label = field?.querySelector<HTMLElement>("label");
          const input = field?.querySelector<MeasurableTextControl>("input, textarea");
          const actions = row.querySelector<HTMLElement>(".method-actions");
          if (!field || !label || !input || !actions) {
            geometryReady = false;
            continue;
          }
          const rowGap = px(window.getComputedStyle(row).columnGap);
          const fieldGap = px(window.getComputedStyle(field).columnGap);
          const valueTrack = groupWidth - rowGap - actions.getBoundingClientRect().width
            - label.getBoundingClientRect().width - fieldGap;
          narrowestValueTrack = Math.min(narrowestValueTrack, valueTrack);
          const textWidth = measureText(input);
          if (textWidth === null || !Number.isFinite(textWidth) || textWidth < 0) {
            geometryReady = false;
          } else {
            textFits.push(textWidth + textControlHorizontalChrome(input));
          }
        }
      }

      // With empty lists there are no row actions to measure; retain room for
      // the number and editable-value tracks so adding a row starts usable.
      if (!Number.isFinite(narrowestValueTrack)) narrowestValueTrack = localeTrack - 30 - 8 - 8;
      if (!geometryReady) return;

      const breathingRoom = stacked ? PAIRED_FIT_RECOVERY_INSET : PAIRED_FIT_STACK_INSET;
      const nextStacked = !layoutFits
        || narrowestValueTrack < MIN_USABLE_PAIRED_LOCALE_TRACK_WIDTH
        || textFits.some(width => width + breathingRoom > narrowestValueTrack);
      setStacked(nextStacked);
    };

    let active = true;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(grid);
    document.fonts?.addEventListener?.("loadingdone", measure);
    if (document.fonts?.ready && typeof document.fonts.ready.then === "function") {
      void document.fonts.ready.then(() => { if (active) measure(); });
    }
    return () => {
      active = false;
      observer?.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [valueSignature, measureText, stacked]);

  return <div ref={gridRef} className={`bilingual-grid methods-grid${stacked ? " is-adaptive-stacked" : ""}`} data-method-list-layout={stacked ? "stacked" : "paired"}>{children}</div>;
}
