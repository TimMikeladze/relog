import { describe, expect, test } from "bun:test";
import { redactMeta } from "../src/server/redact.ts";

describe("redactMeta", () => {
	test("redacts authorization, cookie, token, password keys", () => {
		const input = {
			authorization: "Bearer abc",
			Cookie: "session=xyz",
			password: "hunter2",
			api_key: "k_123",
			user: "alice",
		};
		const result = redactMeta(input) as Record<string, unknown>;
		expect(result.authorization).toBe("[REDACTED]");
		expect(result.Cookie).toBe("[REDACTED]");
		expect(result.password).toBe("[REDACTED]");
		expect(result.api_key).toBe("[REDACTED]");
		expect(result.user).toBe("alice");
	});

	test("redacts within nested objects", () => {
		const input = {
			request: {
				headers: { Authorization: "Bearer abc", "x-trace": "ok" },
				body: { secret: "shh", count: 1 },
			},
		};
		const result = redactMeta(input) as {
			request: { headers: Record<string, string>; body: Record<string, unknown> };
		};
		expect(result.request.headers.Authorization).toBe("[REDACTED]");
		expect(result.request.headers["x-trace"]).toBe("ok");
		expect(result.request.body.secret).toBe("[REDACTED]");
		expect(result.request.body.count).toBe(1);
	});

	test("redacts within arrays of objects", () => {
		const input = {
			events: [{ token: "t1" }, { token: "t2", name: "x" }],
		};
		const result = redactMeta(input) as { events: { token: string; name?: string }[] };
		expect(result.events[0]!.token).toBe("[REDACTED]");
		expect(result.events[1]!.token).toBe("[REDACTED]");
		expect(result.events[1]!.name).toBe("x");
	});

	test("preserves non-object values", () => {
		expect(redactMeta(null)).toBe(null);
		expect(redactMeta(42)).toBe(42);
		expect(redactMeta("plain")).toBe("plain");
		expect(redactMeta(undefined)).toBe(undefined);
	});

	test("does not infinitely recurse on cycles", () => {
		const a: Record<string, unknown> = { name: "a" };
		const b: Record<string, unknown> = { name: "b", a };
		a.b = b;
		// Just must not throw — depth guard saves us.
		expect(() => redactMeta(a)).not.toThrow();
	});
});
