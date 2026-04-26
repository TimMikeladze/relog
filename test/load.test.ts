import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { startServer, type ServerInstance } from "../src/server/server.ts";

/**
 * Load / benchmark suite. Opt-in via `LOAD_TEST=1 bun test test/load.test.ts`
 * so the regular CI suite stays fast. The thresholds are deliberately loose —
 * the goal is regression detection (catching a 10x slowdown), not absolute
 * performance grading. Numbers are also captured to console for human review.
 */
const ENABLED = process.env.LOAD_TEST === "1";

const TEST_DB = "test-load.db";
const ADMIN_KEY = "load-admin";
const READ_KEY = "load-read";
const INGEST_KEY = "load-ingest";

let instance: ServerInstance;
let baseUrl: string;

function cleanup(): void {
	for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
		try {
			unlinkSync(f);
		} catch {}
	}
}

function url(path: string): string {
	return `${baseUrl}${path}`;
}

function pct(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx]!;
}

function makeBatch(size: number, tag: string): unknown[] {
	const batch: unknown[] = [];
	for (let i = 0; i < size; i++) {
		batch.push({
			level: i % 17 === 0 ? "error" : "info",
			message: `${tag} message #${i} ${"x".repeat(40)}`,
			service: `svc-${i % 8}`,
			project: "load",
			branch: "main",
			version: "0.0.0",
			meta: { i, tag, latency_ms: i % 250 },
		});
	}
	return batch;
}

beforeAll(async () => {
	if (!ENABLED) return;
	cleanup();
	instance = await startServer({
		port: 0,
		dbPath: TEST_DB,
		adminKeys: [ADMIN_KEY],
		readKeys: [READ_KEY],
		ingestKeys: [INGEST_KEY],
		// Disable rate limiting for the load test — we are deliberately
		// flooding the endpoint and 429s would mask the actual perf number.
		ingestRpm: 10_000_000,
		streamDebounceMs: 5,
		idleTimeout: 30,
	});
	baseUrl = `http://localhost:${instance.server.port}`;
});

afterAll(async () => {
	if (!ENABLED) return;
	await instance.shutdown();
	cleanup();
});

describe.if(ENABLED)("load: ingest RPS", () => {
	test("sustains ≥500 logs/sec on /ingest", async () => {
		const concurrency = 16;
		const batchesPerWorker = 8;
		const batchSize = 200;
		const totalLogs = concurrency * batchesPerWorker * batchSize;

		const send = async (workerId: number): Promise<void> => {
			for (let b = 0; b < batchesPerWorker; b++) {
				const res = await fetch(url("/ingest"), {
					method: "POST",
					headers: {
						Authorization: `Bearer ${INGEST_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(makeBatch(batchSize, `w${workerId}-b${b}`)),
				});
				if (res.status !== 201) {
					throw new Error(`ingest failed: ${res.status} ${await res.text()}`);
				}
			}
		};

		const t0 = performance.now();
		await Promise.all(Array.from({ length: concurrency }, (_, i) => send(i)));
		const elapsed = performance.now() - t0;
		const rps = (totalLogs / elapsed) * 1000;

		console.log(
			`[load.ingest] ${totalLogs} logs in ${elapsed.toFixed(0)}ms = ${rps.toFixed(0)} logs/sec ` +
				`(${concurrency} workers × ${batchesPerWorker} batches × ${batchSize} logs)`,
		);
		expect(rps).toBeGreaterThan(500);
	}, 60_000);
});

describe.if(ENABLED)("load: query p99", () => {
	test("p99 latency < 1500ms across 100 queries on a seeded DB", async () => {
		// Seed via direct DB insert so we benchmark the read path, not ingest.
		const seedSize = 5000;
		const batches = 5;
		for (let b = 0; b < batches; b++) {
			instance.db.insert(makeBatch(seedSize / batches, `seed-${b}`) as never[]);
		}
		// DuckDB sees SQLite via attached read_only — no view refresh needed.

		const queries = [
			"SELECT COUNT(*) AS n FROM logs",
			"SELECT level, COUNT(*) AS n FROM logs GROUP BY level ORDER BY n DESC",
			"SELECT service, COUNT(*) AS n FROM logs WHERE level = 'error' GROUP BY service",
			"SELECT * FROM logs WHERE message LIKE '%message #100%' LIMIT 50",
			"SELECT date_trunc('minute', CAST(timestamp AS TIMESTAMP)) AS m, COUNT(*) FROM logs GROUP BY m ORDER BY m DESC LIMIT 60",
		];

		const samples: number[] = [];
		const N = 100;
		for (let i = 0; i < N; i++) {
			const sql = queries[i % queries.length]!;
			const t0 = performance.now();
			const res = await fetch(url("/query"), {
				method: "POST",
				headers: {
					Authorization: `Bearer ${READ_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ sql }),
			});
			expect(res.status).toBe(200);
			await res.json();
			samples.push(performance.now() - t0);
		}

		samples.sort((a, b) => a - b);
		const p50 = pct(samples, 50);
		const p95 = pct(samples, 95);
		const p99 = pct(samples, 99);
		console.log(
			`[load.query] N=${N} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
				`(seeded ${seedSize} logs)`,
		);
		expect(p99).toBeLessThan(1500);
	}, 120_000);
});

describe.if(ENABLED)("load: stream fan-out", () => {
	test("delivers events to many concurrent SSE clients", async () => {
		const NUM_CLIENTS = 30;
		const NUM_EVENTS = 50;

		const decoder = new TextDecoder();
		const counts: number[] = new Array(NUM_CLIENTS).fill(0);
		const controllers: AbortController[] = [];

		// All clients connect first; only after they've established do we
		// ingest, so each client sees the full firehose.
		const readers = await Promise.all(
			Array.from({ length: NUM_CLIENTS }, async (_, idx) => {
				const ctrl = new AbortController();
				controllers.push(ctrl);
				const res = await fetch(url("/stream"), {
					headers: { Authorization: `Bearer ${READ_KEY}` },
					signal: ctrl.signal,
				});
				if (!res.body) throw new Error(`client ${idx}: no body`);
				return res.body.getReader();
			}),
		);

		// Drain in background; count `data:` events per client.
		const drainPromises = readers.map(async (reader, idx) => {
			let buf = "";
			while (counts[idx]! < NUM_EVENTS) {
				const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }));
				if (chunk.done) break;
				buf += decoder.decode(chunk.value, { stream: true });
				let nl = buf.indexOf("\n\n");
				while (nl !== -1) {
					const block = buf.slice(0, nl);
					buf = buf.slice(nl + 2);
					if (block.includes("data:") && !block.startsWith(":")) {
						counts[idx]!++;
					}
					nl = buf.indexOf("\n\n");
				}
			}
		});

		// Small grace for clients to hit the server's `start()` callback
		// and register before we notify.
		await Bun.sleep(200);

		// Ingest in chunks so notify() has time to drain between flushes.
		const chunkSize = 10;
		for (let sent = 0; sent < NUM_EVENTS; sent += chunkSize) {
			const res = await fetch(url("/ingest"), {
				method: "POST",
				headers: {
					Authorization: `Bearer ${INGEST_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(makeBatch(chunkSize, `stream-${sent}`)),
			});
			expect(res.status).toBe(201);
			await Bun.sleep(20);
		}

		// Wait for fan-out, but bound the wait — if a client is stuck
		// the test should fail with a clear count, not hang.
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline && counts.some((c) => c < NUM_EVENTS)) {
			await Bun.sleep(50);
		}

		for (const ctrl of controllers) ctrl.abort();
		await Promise.allSettled(drainPromises);

		const min = Math.min(...counts);
		const max = Math.max(...counts);
		console.log(
			`[load.stream] ${NUM_CLIENTS} clients, ${NUM_EVENTS} events: min=${min} max=${max}`,
		);
		// Every client should have received at least the events we ingested.
		// Allow a tiny shortfall (1 event) for race conditions where the
		// final flush lands after our deadline.
		expect(min).toBeGreaterThanOrEqual(NUM_EVENTS - 1);
	}, 60_000);
});

if (!ENABLED) {
	test.skip("load tests skipped (set LOAD_TEST=1 to enable)", () => {});
}
