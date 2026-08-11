import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	activeFilterCount,
	buildWhere,
	describeRange,
	isRelativeTime,
	levelColor,
	relativeToMs,
	resolveRange,
	splitValues,
	toggleValue,
} from "./log-filters";

const NOW = new Date("2026-08-10T21:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("relative time", () => {
	test("recognises the units the server accepts", () => {
		for (const value of ["5m", "1h", "24h", "30d", "6M", "1y"]) {
			expect(isRelativeTime(value)).toBe(true);
		}
	});

	test("rejects absolute timestamps and junk", () => {
		expect(isRelativeTime("2026-08-10T21:00:00.000Z")).toBe(false);
		expect(isRelativeTime("soon")).toBe(false);
		expect(isRelativeTime(undefined)).toBe(false);
	});

	test("converts to milliseconds", () => {
		expect(relativeToMs("15m")).toBe(900_000);
		expect(relativeToMs("2h")).toBe(7_200_000);
		expect(relativeToMs("nope")).toBeNull();
	});
});

describe("resolveRange", () => {
	test("treats a relative `from` as an offset from now", () => {
		expect(resolveRange({ from: "1h" })).toEqual({ fromMs: NOW - 3_600_000, toMs: null });
	});

	test("passes absolute bounds through", () => {
		const from = "2026-08-10T20:00:00.000Z";
		const to = "2026-08-10T20:30:00.000Z";
		expect(resolveRange({ from, to })).toEqual({
			fromMs: new Date(from).getTime(),
			toMs: new Date(to).getTime(),
		});
	});

	test("drops unparseable dates rather than emitting NaN bounds", () => {
		expect(resolveRange({ from: "not-a-date" })).toEqual({ fromMs: null, toMs: null });
	});
});

describe("buildWhere", () => {
	test("returns an empty clause when nothing is filtered", () => {
		expect(buildWhere({})).toEqual({ sql: "", params: [] });
	});

	test("binds values instead of interpolating them", () => {
		const { sql, params } = buildWhere({ service: "api-server" });
		expect(sql).toBe("WHERE service IN (?)");
		expect(params).toEqual(["api-server"]);
	});

	test("expands a multi-select into one placeholder per value", () => {
		const { sql, params } = buildWhere({ level: "error,fatal" });
		expect(sql).toBe("WHERE level IN (?, ?)");
		expect(params).toEqual(["error", "fatal"]);
	});

	// The whole point of `exclude`: a facet must not constrain its own counts,
	// or selecting one service reports zero for every other one.
	test("omits the excluded dimension but keeps the others", () => {
		const { sql, params } = buildWhere({ level: "error", service: "worker" }, "service");
		expect(sql).toBe("WHERE level IN (?)");
		expect(params).toEqual(["error"]);
	});

	test("combines the time range with facets in order", () => {
		const { sql, params } = buildWhere({ from: "1h", level: "warn" });
		expect(sql).toBe("WHERE created_at >= ? AND level IN (?)");
		expect(params).toEqual([NOW - 3_600_000, "warn"]);
	});

	test("escapes LIKE wildcards so a literal % stays literal", () => {
		const { sql, params } = buildWhere({ grep: "100%_done" });
		expect(sql).toBe("WHERE message LIKE ? ESCAPE '\\'");
		expect(params).toEqual(["%100\\%\\_done%"]);
	});

	test("binds a quote-bearing value rather than breaking the statement", () => {
		const { params } = buildWhere({ service: "it's-fine" });
		expect(params).toEqual(["it's-fine"]);
	});
});

describe("describeRange", () => {
	test("names a relative preset", () => {
		expect(describeRange({ from: "1h" })).toBe("Last 1 hour");
		expect(describeRange({ from: "30m" })).toBe("Last 30 min");
	});

	test("falls back to All time when unbounded", () => {
		expect(describeRange({})).toBe("All time");
	});

	test("renders an absolute range as an interval ending in Now when open", () => {
		expect(describeRange({ from: "2026-08-10T20:00:00.000Z" })).toMatch(/– Now$/);
	});
});

describe("multi-select helpers", () => {
	test("splits and drops empties", () => {
		expect(splitValues("a,,b")).toEqual(["a", "b"]);
		expect(splitValues(undefined)).toEqual([]);
	});

	test("toggles a value on and off", () => {
		expect(toggleValue(undefined, "error")).toBe("error");
		expect(toggleValue("error", "fatal")).toBe("error,fatal");
		expect(toggleValue("error,fatal", "error")).toBe("fatal");
	});

	test("clearing the last value yields undefined, not an empty string", () => {
		expect(toggleValue("error", "error")).toBeUndefined();
	});
});

describe("activeFilterCount", () => {
	test("counts only narrowing filters", () => {
		expect(activeFilterCount({})).toBe(0);
		expect(activeFilterCount({ level: "error", from: "1h" })).toBe(2);
		// `around_id` positions the view; it doesn't narrow the set.
		expect(activeFilterCount({ around_id: "42" })).toBe(0);
	});
});

describe("levelColor", () => {
	test("maps every level to its own token", () => {
		expect(levelColor("error")).toBe("var(--level-error)");
		expect(levelColor("info")).toBe("var(--level-info)");
	});

	test("falls back rather than returning undefined for an unknown level", () => {
		expect(levelColor("bogus")).toBe("var(--level-trace)");
	});
});
