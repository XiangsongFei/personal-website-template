export type PairedValueFit = {
  textWidth: number;
  horizontalChrome: number;
};

export const PAIRED_FIT_STACK_INSET = 8;
export const PAIRED_FIT_RECOVERY_INSET = 16;
// At the Admin's 15px input size, 120px leaves a useful single-line editing
// area while still allowing compact locale pairs on narrow screens.
export const MIN_USABLE_PAIRED_LOCALE_TRACK_WIDTH = 120;

/** Decide against the hypothetical 50/50 track, including while currently stacked. */
export function shouldStackPairedValues(
  currentlyStacked: boolean,
  values: readonly PairedValueFit[],
  pairedColumnWidth: number,
): boolean | null {
  if (!Number.isFinite(pairedColumnWidth) || pairedColumnWidth <= 0
    || values.some(value => !Number.isFinite(value.textWidth) || value.textWidth < 0 || !Number.isFinite(value.horizontalChrome) || value.horizontalChrome < 0)) return null;
  if (pairedColumnWidth < MIN_USABLE_PAIRED_LOCALE_TRACK_WIDTH) return true;
  const breathingRoom = currentlyStacked ? PAIRED_FIT_RECOVERY_INSET : PAIRED_FIT_STACK_INSET;
  return values.some(value => value.textWidth + value.horizontalChrome + breathingRoom > pairedColumnWidth);
}

export type MeasurableTextControl = HTMLInputElement | HTMLTextAreaElement;

/** Measure a single-line text control using its own computed font, not character counts. */
export function measureTextControlWidth(input: MeasurableTextControl): number | null {
  if (typeof document === "undefined" || typeof CanvasRenderingContext2D === "undefined") return null;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const style = window.getComputedStyle(input);
  const value = input.value;
  // Canvas font does not consistently accept the computed shorthand's line-height segment.
  context.font = [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
  return value.split(/\r?\n/).reduce((maximum, line) => Math.max(maximum,
    context.measureText(line).width + Math.max(0, line.length - 1) * letterSpacing), 0);
}

export function textControlHorizontalChrome(input: MeasurableTextControl): number {
  const style = window.getComputedStyle(input);
  return [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .map(value => Number.parseFloat(value) || 0)
    .reduce((total, value) => total + value, 0);
}
