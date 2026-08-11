/**
 * Categorical series colours for dashboard widgets.
 *
 * The slot order is the colourblind-safety mechanism, not a style choice:
 * adjacent slots are the pairs that end up touching in a stack or a legend, and
 * this order is what keeps them separable under protanopia and deuteranopia.
 * Assign in sequence and never reorder.
 */
export const SERIES_SLOTS = 8;

/**
 * Colour for series `index`.
 *
 * Past the eighth slot this returns a neutral rather than wrapping around.
 * Cycling — which the widgets used to do with a six-entry array — makes the
 * 7th series indistinguishable from the 1st, so the chart claims two different
 * things are the same thing.
 */
export function seriesColor(index: number): string {
	if (index < 0 || index >= SERIES_SLOTS) return "var(--series-overflow)";
	return `var(--series-${index + 1})`;
}

/** True once a chart has more series than the palette can identify. */
export function hasOverflowSeries(count: number): boolean {
	return count > SERIES_SLOTS;
}

/** Reserved status colours. Never used to mean "series N". */
export const STATUS_COLORS = {
	good: "var(--status-good)",
	warning: "var(--status-warning)",
	critical: "var(--status-critical)",
} as const;
