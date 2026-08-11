import { describe, expect, test } from "vitest";
import { hasOverflowSeries, SERIES_SLOTS, seriesColor, STATUS_COLORS } from "./series-colors";

describe("seriesColor", () => {
	test("assigns slots in order", () => {
		expect(seriesColor(0)).toBe("var(--series-1)");
		expect(seriesColor(7)).toBe("var(--series-8)");
	});

	test("gives every slot a distinct token", () => {
		const seen = new Set(Array.from({ length: SERIES_SLOTS }, (_, i) => seriesColor(i)));
		expect(seen.size).toBe(SERIES_SLOTS);
	});

	// The bug this replaced: `LINE_COLORS[i % 6]` painted the 7th series the
	// same colour as the 1st, so a chart asserted two series were one.
	test("does not wrap around past the last slot", () => {
		expect(seriesColor(SERIES_SLOTS)).not.toBe(seriesColor(0));
		expect(seriesColor(SERIES_SLOTS)).toBe("var(--series-overflow)");
		expect(seriesColor(99)).toBe("var(--series-overflow)");
	});

	test("handles a negative index without returning a real slot", () => {
		expect(seriesColor(-1)).toBe("var(--series-overflow)");
	});
});

describe("hasOverflowSeries", () => {
	test("flags only counts the palette cannot identify", () => {
		expect(hasOverflowSeries(SERIES_SLOTS)).toBe(false);
		expect(hasOverflowSeries(SERIES_SLOTS + 1)).toBe(true);
	});
});

describe("STATUS_COLORS", () => {
	// Status hues are reserved: if one leaked into the categorical ramp, a
	// series would start reading as "this thing is broken".
	test("stay disjoint from the series slots", () => {
		const series = new Set(Array.from({ length: SERIES_SLOTS }, (_, i) => seriesColor(i)));
		for (const status of Object.values(STATUS_COLORS)) {
			expect(series.has(status)).toBe(false);
		}
	});
});
