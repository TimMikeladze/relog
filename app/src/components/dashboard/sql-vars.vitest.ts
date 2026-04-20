import { describe, expect, test } from "vitest";
import { substituteVars } from "./sql-vars";

const VARS = { from: 1000, to: 2000, service: "api", project: "web" };

describe("substituteVars", () => {
	test("substitutes all known vars", () => {
		const out = substituteVars(
			"SELECT * FROM logs WHERE created_at BETWEEN ${from} AND ${to} AND service = ${service} AND project = ${project}",
			VARS,
		);
		expect(out).toBe(
			"SELECT * FROM logs WHERE created_at BETWEEN 1000 AND 2000 AND service = 'api' AND project = 'web'",
		);
	});

	test("unset service substitutes NULL", () => {
		const out = substituteVars("SELECT ${service}", { from: 0, to: 0 });
		expect(out).toBe("SELECT NULL");
	});

	test("escapes single quotes in service name", () => {
		const out = substituteVars("SELECT ${service}", { ...VARS, service: "a'b" });
		expect(out).toBe("SELECT 'a''b'");
	});

	test("unknown placeholder throws", () => {
		expect(() => substituteVars("SELECT ${nope}", VARS)).toThrow(/Unknown placeholder: nope/);
	});

	test("leaves unrelated $ alone", () => {
		expect(substituteVars("SELECT '$100' AS price", VARS)).toBe("SELECT '$100' AS price");
	});

	test("injection in service name stays quoted", () => {
		const out = substituteVars("SELECT ${service}", {
			...VARS,
			service: "'; DROP TABLE logs; --",
		});
		expect(out).toBe("SELECT '''; DROP TABLE logs; --'");
	});

	test("numeric from/to are floored to integer literals", () => {
		const out = substituteVars("${from} ${to}", { from: 1000.9, to: 2000.1 });
		expect(out).toBe("1000 2000");
	});
});
