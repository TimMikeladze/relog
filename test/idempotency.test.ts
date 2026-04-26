import { describe, expect, test } from "bun:test";
import {
	IdempotencyStore,
	cachedToResponse,
	readIdempotencyKey,
} from "../src/server/idempotency.ts";

describe("IdempotencyStore", () => {
	test("returns cached entry within TTL", () => {
		const store = new IdempotencyStore(60_000, 100);
		store.put("ingest", "pfx", "key-1", {
			status: 201,
			body: "{}",
			contentType: "application/json",
		});
		const cached = store.get("ingest", "pfx", "key-1");
		expect(cached?.status).toBe(201);
		expect(cached?.body).toBe("{}");
	});

	test("scopes entries per key prefix", () => {
		const store = new IdempotencyStore();
		store.put("ingest", "pfx-a", "k", { status: 200, body: "a", contentType: "application/json" });
		store.put("ingest", "pfx-b", "k", { status: 200, body: "b", contentType: "application/json" });
		expect(store.get("ingest", "pfx-a", "k")?.body).toBe("a");
		expect(store.get("ingest", "pfx-b", "k")?.body).toBe("b");
	});

	test("scopes entries per route", () => {
		const store = new IdempotencyStore();
		store.put("ingest", "p", "k", { status: 201, body: "ingest", contentType: "application/json" });
		store.put("otel-logs", "p", "k", {
			status: 200,
			body: "otel",
			contentType: "application/json",
		});
		expect(store.get("ingest", "p", "k")?.body).toBe("ingest");
		expect(store.get("otel-logs", "p", "k")?.body).toBe("otel");
	});

	test("expires entries past TTL", async () => {
		const store = new IdempotencyStore(10, 100);
		store.put("ingest", "pfx", "k", { status: 200, body: "v", contentType: "application/json" });
		await Bun.sleep(20);
		expect(store.get("ingest", "pfx", "k")).toBeNull();
	});

	test("evicts oldest when at capacity", () => {
		const store = new IdempotencyStore(60_000, 2);
		store.put("ingest", "p", "a", { status: 200, body: "1", contentType: "application/json" });
		store.put("ingest", "p", "b", { status: 200, body: "2", contentType: "application/json" });
		store.put("ingest", "p", "c", { status: 200, body: "3", contentType: "application/json" });
		expect(store.get("ingest", "p", "a")).toBeNull();
		expect(store.get("ingest", "p", "b")?.body).toBe("2");
		expect(store.get("ingest", "p", "c")?.body).toBe("3");
	});
});

describe("readIdempotencyKey", () => {
	test("reads canonical Idempotency-Key", () => {
		const req = new Request("http://x/", { headers: { "Idempotency-Key": "abc-123" } });
		expect(readIdempotencyKey(req)).toBe("abc-123");
	});

	test("falls back to X-Idempotency-Key", () => {
		const req = new Request("http://x/", { headers: { "X-Idempotency-Key": "fallback" } });
		expect(readIdempotencyKey(req)).toBe("fallback");
	});

	test("rejects oversized keys", () => {
		const big = "a".repeat(300);
		const req = new Request("http://x/", { headers: { "Idempotency-Key": big } });
		expect(readIdempotencyKey(req)).toBeNull();
	});

	test("returns null for missing or empty header", () => {
		expect(readIdempotencyKey(new Request("http://x/"))).toBeNull();
		const req = new Request("http://x/", { headers: { "Idempotency-Key": "  " } });
		expect(readIdempotencyKey(req)).toBeNull();
	});
});

describe("cachedToResponse", () => {
	test("emits Idempotent-Replay header", async () => {
		const res = cachedToResponse({
			status: 201,
			body: '{"x":1}',
			contentType: "application/json",
			createdAt: Date.now(),
		});
		expect(res.status).toBe(201);
		expect(res.headers.get("Idempotent-Replay")).toBe("true");
		expect(await res.json()).toEqual({ x: 1 });
	});
});
