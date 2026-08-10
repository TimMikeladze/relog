import { describe, expect, test } from "vitest";
import {
	defaultVarValues,
	extractPlaceholders,
	substituteVars,
	undeclaredPlaceholders,
} from "./sql-vars";
import type { DashboardVariable } from "@/types";

const VARIABLES: DashboardVariable[] = [
	{ name: "service", type: "select" },
	{ name: "project", type: "select" },
];

const VARS = { from: 1000, to: 2000, service: "api", project: "web" };
const OPTS = { variables: VARIABLES };

describe("substituteVars", () => {
	test("substitutes builtins and declared variables", () => {
		const out = substituteVars(
			"SELECT * FROM logs WHERE created_at BETWEEN ${from} AND ${to} AND service = ${service} AND project = ${project}",
			VARS,
			OPTS,
		);
		expect(out).toBe(
			"SELECT * FROM logs WHERE created_at BETWEEN 1000 AND 2000 AND service = 'api' AND project = 'web'",
		);
	});

	test("unset variable substitutes NULL", () => {
		expect(substituteVars("SELECT ${service}", { from: 0, to: 0 }, OPTS)).toBe("SELECT NULL");
		expect(substituteVars("SELECT ${service}", { from: 0, to: 0, service: "" }, OPTS)).toBe(
			"SELECT NULL",
		);
	});

	test("escapes single quotes", () => {
		expect(substituteVars("SELECT ${service}", { ...VARS, service: "a'b" }, OPTS)).toBe(
			"SELECT 'a''b'",
		);
	});

	test("injection attempt stays inside a quoted literal", () => {
		const out = substituteVars(
			"SELECT ${service}",
			{ ...VARS, service: "'; DROP TABLE logs; --" },
			OPTS,
		);
		expect(out).toBe("SELECT '''; DROP TABLE logs; --'");
	});

	test("undeclared placeholder throws rather than silently widening scope", () => {
		expect(() => substituteVars("SELECT ${nope}", VARS, OPTS)).toThrow(/Unknown placeholder: nope/);
	});

	test("lenient mode substitutes NULL for undeclared placeholders", () => {
		expect(substituteVars("SELECT ${nope}", VARS, { ...OPTS, lenient: true })).toBe("SELECT NULL");
	});

	test("number variables become bare numeric literals", () => {
		const vars = { from: 0, to: 0, threshold: "250" };
		const declarations: DashboardVariable[] = [{ name: "threshold", type: "number" }];
		expect(substituteVars("WHERE d > ${threshold}", vars, { variables: declarations })).toBe(
			"WHERE d > 250",
		);
	});

	test("a non-numeric value in a number variable reads as unset", () => {
		const declarations: DashboardVariable[] = [{ name: "threshold", type: "number" }];
		expect(
			substituteVars(
				"WHERE d > ${threshold}",
				{ from: 0, to: 0, threshold: "abc" },
				{
					variables: declarations,
				},
			),
		).toBe("WHERE d > NULL");
	});

	test("leaves unrelated $ alone", () => {
		expect(substituteVars("SELECT '$100' AS price", VARS, OPTS)).toBe("SELECT '$100' AS price");
	});

	test("from/to are floored to integer literals", () => {
		expect(substituteVars("${from} ${to}", { from: 1000.9, to: 2000.1 }, OPTS)).toBe("1000 2000");
	});

	test("from/to cannot be shadowed by a declared variable", () => {
		// The server rejects `from`/`to` as variable names, but a hand-edited
		// dashboards.json could still carry one. It must not change how the time
		// range reaches SQL.
		const shadow: DashboardVariable[] = [{ name: "from", type: "text" }];
		expect(substituteVars("${from}", { from: 5, to: 9 }, { variables: shadow })).toBe("5");
	});
});

describe("extractPlaceholders", () => {
	test("returns each referenced name once", () => {
		expect(extractPlaceholders("${a} ${b} ${a}")).toEqual(["a", "b"]);
		expect(extractPlaceholders("SELECT 1")).toEqual([]);
	});
});

describe("undeclaredPlaceholders", () => {
	test("ignores builtins and declared variables", () => {
		expect(undeclaredPlaceholders("${from} ${to} ${service} ${typo}", VARIABLES)).toEqual(["typo"]);
	});
});

describe("defaultVarValues", () => {
	test("uses declared defaults, empty string for none", () => {
		expect(
			defaultVarValues([
				{ name: "a", type: "text", default: "x" },
				{ name: "b", type: "text" },
				{ name: "c", type: "number", default: 5 },
			]),
		).toEqual({ a: "x", b: "", c: "5" });
	});
});
