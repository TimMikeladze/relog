import { describe, expect, test } from "vitest";
import { formatClockTime, formatFullTimestamp } from "./format-time";

// Regression, four call sites deep: `fractionalSecondDigits` passed without
// hour/minute/second makes Intl emit ONLY the fraction, so the Query results
// table rendered "165" and the detail panel "AUG 10 43 GMT-7".
describe("formatClockTime", () => {
	test("renders a full clock time, not just the fraction", () => {
		expect(formatClockTime("2026-08-10T21:44:45.432Z")).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
	});

	test("honours the requested fraction width", () => {
		expect(formatClockTime("2026-08-10T21:44:45.432Z", 2)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{2}$/);
	});

	test("accepts Date and epoch inputs", () => {
		const iso = "2026-08-10T21:44:45.432Z";
		expect(formatClockTime(new Date(iso))).toBe(formatClockTime(iso));
		expect(formatClockTime(new Date(iso).getTime())).toBe(formatClockTime(iso));
	});

	test("returns the input unchanged when it isn't a date", () => {
		expect(formatClockTime("not-a-timestamp")).toBe("not-a-timestamp");
	});
});

describe("formatFullTimestamp", () => {
	test("includes month, padded day, full time and zone", () => {
		expect(formatFullTimestamp("2026-08-10T21:44:45.432Z")).toMatch(
			/^AUG \d{2} \d{2}:\d{2}:\d{2}\.\d{2} GMT/,
		);
	});

	test("pads a single-digit day", () => {
		expect(formatFullTimestamp("2026-08-03T10:00:00.000Z")).toMatch(/^AUG 03 /);
	});

	test("returns the input unchanged when it isn't a date", () => {
		expect(formatFullTimestamp("nope")).toBe("nope");
	});
});
