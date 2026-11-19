/** Evaluate against the hypothetical two-column track in both layouts. */
export function stackPairedControls(width: number, gap: number, requiredWidths: readonly number[], stacked: boolean) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(gap) || requiredWidths.some(value => !Number.isFinite(value))) return stacked;
  const trackWidth = (width - gap) / 2;
  const reserve = stacked ? 16 : 8;
  return trackWidth < (stacked ? 144 : 136) || requiredWidths.some(required => required + reserve > trackWidth);
}
