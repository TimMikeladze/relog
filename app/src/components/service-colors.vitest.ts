import { describe, expect, test } from "vitest";
import { getServiceColor } from "./service-colors";

// Sample of plausible service names. We don't try to enumerate the
// universe — we just want to confirm the djb2-style hash + modulo
// doesn't catastrophically clump everything onto one or two palette
// entries (which is the actual P2 concern).
const NAMES = [
	"api",
	"api-gateway",
	"auth",
	"billing",
	"cart",
	"checkout",
	"db",
	"email",
	"frontend",
	"gateway",
	"ingest",
	"logger",
	"metrics",
	"notifications",
	"orders",
	"payments",
	"profile",
	"queue",
	"recommender",
	"reporting",
	"scheduler",
	"search",
	"sessions",
	"shipping",
	"signup",
	"stats",
	"storefront",
	"tracking",
	"user-service",
	"web",
	"worker",
	"backend",
	"admin",
	"analytics",
	"chat",
	"docs",
	"feed",
	"image-processor",
	"inventory",
	"loadbalancer",
];

describe("getServiceColor", () => {
	test("is deterministic", () => {
		expect(getServiceColor("payments")).toBe(getServiceColor("payments"));
	});

	test("spreads names across the palette", () => {
		const counts = new Map<string, number>();
		for (const name of NAMES) {
			const c = getServiceColor(name);
			counts.set(c.bar, (counts.get(c.bar) ?? 0) + 1);
		}
		// Palette has 10 buckets; with 40 inputs perfect spread = 4/bucket.
		// Allow some skew but require at least 6 of 10 buckets used and no
		// single bucket holding more than 30% of the names.
		expect(counts.size).toBeGreaterThanOrEqual(6);
		const max = Math.max(...counts.values());
		expect(max).toBeLessThanOrEqual(Math.ceil(NAMES.length * 0.3));
	});

	test("does not crash on empty / unicode service names", () => {
		expect(() => getServiceColor("")).not.toThrow();
		expect(() => getServiceColor("ユーザー")).not.toThrow();
		expect(() => getServiceColor("🚀-svc")).not.toThrow();
	});
});
