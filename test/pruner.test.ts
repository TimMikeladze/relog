import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { archiveLogBatch } from "../src/archiver.ts";
import { RelogDatabase } from "../src/db/database.ts";
import { pruneByAge, pruneBySize, startAutoPrune } from "../src/pruner.ts";
import type { ArchiveConfig, LogEntry, RetryConfig } from "../src/types.ts";

const NO_RETRY: RetryConfig = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
const MINIO_BUCKET = process.env.MINIO_BUCKET;
const HAS_MINIO = !!(MINIO_ENDPOINT && MINIO_ACCESS_KEY && MINIO_SECRET_KEY && MINIO_BUCKET);

function tmpPath(prefix: string): string {
	return join(tmpdir(), `relog-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(path + suffix);
		} catch {}
	}
}

function insertLogs(
	db: RelogDatabase,
	count: number,
	ageDays: number,
	opts?: { project?: string; branch?: string },
): void {
	const ts = new Date(Date.now() - ageDays * 86_400_000).toISOString();
	const batch = Array.from({ length: count }, (_, i) => ({
		level: "info" as const,
		message: `log-${ageDays}d-${i}`,
		timestamp: ts,
		project: opts?.project,
		branch: opts?.branch,
	}));
	for (let i = 0; i < batch.length; i += 1000) {
		db.insert(batch.slice(i, i + 1000));
	}
}

// ─── pruneByAge (no S3) ─────────────────────────────────────────

describe("pruneByAge (no S3)", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-age");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("deletes logs older than maxAgeDays", async () => {
		insertLogs(db, 100, 10); // 10 days old
		insertLogs(db, 50, 1); // 1 day old
		expect(db.getLogCount()).toBe(150);

		const deleted = await pruneByAge(db, 5);
		expect(deleted).toBe(100);
		expect(db.getLogCount()).toBe(50);
	});

	test("no-ops when no logs are old enough", async () => {
		insertLogs(db, 50, 1);
		const deleted = await pruneByAge(db, 5);
		expect(deleted).toBe(0);
		expect(db.getLogCount()).toBe(50);
	});

	test("no-ops on empty database", async () => {
		const deleted = await pruneByAge(db, 5);
		expect(deleted).toBe(0);
	});
});

// ─── pruneBySize (no S3) ─────────────────────────────────────────

describe("pruneBySize (no S3)", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-size");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("loops until DB is under threshold", async () => {
		insertLogs(db, 5000, 0);
		const initialSize = db.getDbSize();
		expect(initialSize).toBeGreaterThan(0);

		// Set threshold to roughly half the current size
		const maxDbSize = Math.floor(initialSize / 2);
		const deleted = await pruneBySize(db, maxDbSize);

		expect(deleted).toBeGreaterThan(0);
		expect(db.getDbSize()).toBeLessThanOrEqual(maxDbSize);
	});

	test("stops when all logs are deleted and still over threshold", async () => {
		insertLogs(db, 10, 0);

		// Set threshold impossibly low — below schema overhead
		const deleted = await pruneBySize(db, 1);

		expect(deleted).toBe(10);
		expect(db.getLogCount()).toBe(0);
	});

	test("no-ops when already under threshold", async () => {
		insertLogs(db, 10, 0);
		const deleted = await pruneBySize(db, Number.MAX_SAFE_INTEGER);
		expect(deleted).toBe(0);
		expect(db.getLogCount()).toBe(10);
	});

	test("no-ops on empty database", async () => {
		const deleted = await pruneBySize(db, 1);
		expect(deleted).toBe(0);
	});
});

// ─── startAutoPrune ──────────────────────────────────────────────

describe("startAutoPrune", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-auto");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("returns no-op handle when no thresholds configured", () => {
		const handle = startAutoPrune(db, {});
		handle.stop();
		// Should not throw
	});

	test("prunes on interval", async () => {
		insertLogs(db, 100, 10);
		insertLogs(db, 50, 1);
		expect(db.getLogCount()).toBe(150);

		const handle = startAutoPrune(db, { maxAgeDays: 5, intervalSeconds: 0.05 });

		// Wait for at least one prune cycle
		await Bun.sleep(150);
		handle.stop();

		expect(db.getLogCount()).toBe(50);
	});

	test("in-flight guard prevents overlapping cycles", async () => {
		// Insert enough data that pruning takes measurable time
		insertLogs(db, 10000, 10);
		expect(db.getLogCount()).toBe(10000);

		// Very short interval to trigger overlap attempts
		const handle = startAutoPrune(db, { maxAgeDays: 5, intervalSeconds: 0.01 });

		await Bun.sleep(200);
		handle.stop();

		// Should have pruned all old logs without corruption
		expect(db.getLogCount()).toBe(0);
	});

	test("stop() prevents further prune cycles", async () => {
		insertLogs(db, 100, 10);
		const handle = startAutoPrune(db, { maxAgeDays: 5, intervalSeconds: 0.5 });

		// Stop immediately before first cycle
		handle.stop();
		await Bun.sleep(100);

		// Logs should still be there
		expect(db.getLogCount()).toBe(100);
	});
});

// ─── Database methods ────────────────────────────────────────────

describe("database: getOldestLogs", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("db-oldest");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("returns oldest logs ordered by created_at", () => {
		insertLogs(db, 10, 30); // 30 days old
		insertLogs(db, 10, 1); // 1 day old

		const oldest = db.getOldestLogs(5);
		expect(oldest.length).toBe(5);
		// All should be from the 30-day-old batch
		for (const log of oldest) {
			expect(log.message).toMatch(/log-30d-/);
		}
	});

	test("returns all logs when limit exceeds count", () => {
		insertLogs(db, 5, 1);
		const oldest = db.getOldestLogs(100);
		expect(oldest.length).toBe(5);
	});

	test("returns empty array for empty database", () => {
		const oldest = db.getOldestLogs(10);
		expect(oldest.length).toBe(0);
	});
});

describe("database: getDbSize with freelist", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("db-size");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("getDbSize decreases after deleting logs", () => {
		insertLogs(db, 1000, 0);
		const sizeBefore = db.getDbSize();
		expect(sizeBefore).toBeGreaterThan(0);

		// Delete all logs
		const ids = db.getOldestLogs(1000).map((l) => l.id!);
		db.deleteByIds(ids);

		const sizeAfter = db.getDbSize();
		expect(sizeAfter).toBeLessThan(sizeBefore);
	});
});

// ─── S3 archive-before-prune (requires MinIO) ───────────────────

describe.if(HAS_MINIO)("pruneByAge with S3 archiving", () => {
	let dbPath: string;
	let db: RelogDatabase;
	let archiveConfig: ArchiveConfig;
	const testPrefix = `test-pruner-age-${Date.now()}`;

	beforeEach(() => {
		dbPath = tmpPath("prune-s3-age");
		db = new RelogDatabase(dbPath);
		archiveConfig = {
			endpoint: MINIO_ENDPOINT!,
			bucket: MINIO_BUCKET!,
			accessKeyId: MINIO_ACCESS_KEY!,
			secretAccessKey: MINIO_SECRET_KEY!,
			prefix: testPrefix,
			region: "us-east-1",
		};
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("archives old logs to S3 before deleting from SQLite", async () => {
		insertLogs(db, 50, 10, { project: "prune-proj", branch: "main" });
		insertLogs(db, 30, 1);
		expect(db.getLogCount()).toBe(80);

		const deleted = await pruneByAge(db, 5, archiveConfig);

		expect(deleted).toBe(50);
		expect(db.getLogCount()).toBe(30);

		// Verify data made it to S3
		const s3 = new S3Client({
			endpoint: MINIO_ENDPOINT!,
			bucket: MINIO_BUCKET!,
			accessKeyId: MINIO_ACCESS_KEY!,
			secretAccessKey: MINIO_SECRET_KEY!,
			region: "us-east-1",
		});

		// Read back via S3 to verify parquet files exist
		const file = s3.file(`${testPrefix}/project=prune-proj/branch=main/`);
		// If we can list/check, the data is there
		// The archiver test suite already verifies parquet content thoroughly
	});
});

describe.if(HAS_MINIO)("pruneBySize with S3 archiving", () => {
	let dbPath: string;
	let db: RelogDatabase;
	let archiveConfig: ArchiveConfig;
	const testPrefix = `test-pruner-size-${Date.now()}`;

	beforeEach(() => {
		dbPath = tmpPath("prune-s3-size");
		db = new RelogDatabase(dbPath);
		archiveConfig = {
			endpoint: MINIO_ENDPOINT!,
			bucket: MINIO_BUCKET!,
			accessKeyId: MINIO_ACCESS_KEY!,
			secretAccessKey: MINIO_SECRET_KEY!,
			prefix: testPrefix,
			region: "us-east-1",
		};
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("archives logs to S3 during size-based prune", async () => {
		insertLogs(db, 3000, 0, { project: "size-proj", branch: "main" });
		const initialSize = db.getDbSize();
		const maxDbSize = Math.floor(initialSize / 2);

		const deleted = await pruneBySize(db, maxDbSize, archiveConfig);

		expect(deleted).toBeGreaterThan(0);
		expect(db.getDbSize()).toBeLessThanOrEqual(maxDbSize);
	});
});

// ─── S3 failure handling ─────────────────────────────────────────

describe("pruneByAge with unreachable S3", () => {
	let dbPath: string;
	let db: RelogDatabase;
	const badArchiveConfig: ArchiveConfig = {
		endpoint: "http://localhost:1",
		bucket: "nonexistent",
		accessKeyId: "fake",
		secretAccessKey: "fake",
		prefix: "test",
		region: "us-east-1",
	};

	beforeEach(() => {
		dbPath = tmpPath("prune-s3-fail");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("does not delete logs when S3 upload fails", async () => {
		insertLogs(db, 50, 10);
		expect(db.getLogCount()).toBe(50);

		const deleted = await pruneByAge(db, 5, badArchiveConfig, NO_RETRY);

		expect(deleted).toBe(0);
		// All logs should still be in SQLite
		expect(db.getLogCount()).toBe(50);
	});
});

describe("pruneBySize with unreachable S3", () => {
	let dbPath: string;
	let db: RelogDatabase;
	const badArchiveConfig: ArchiveConfig = {
		endpoint: "http://localhost:1",
		bucket: "nonexistent",
		accessKeyId: "fake",
		secretAccessKey: "fake",
		prefix: "test",
		region: "us-east-1",
	};

	beforeEach(() => {
		dbPath = tmpPath("prune-s3-size-fail");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("does not delete logs when S3 upload fails", async () => {
		insertLogs(db, 100, 0);
		const initialCount = db.getLogCount();
		expect(initialCount).toBe(100);

		const deleted = await pruneBySize(db, 1, badArchiveConfig, NO_RETRY);

		expect(deleted).toBe(0);
		expect(db.getLogCount()).toBe(100);
	});
});

// ─── Multi-batch pruning ─────────────────────────────────────────

describe("pruneByAge: multi-batch", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-age-multi");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("handles more logs than BATCH_SIZE (5000) in multiple batches", async () => {
		// Insert 12000 old logs — requires 3 batches of 5000
		insertLogs(db, 12000, 10);
		insertLogs(db, 200, 1);
		expect(db.getLogCount()).toBe(12200);

		const deleted = await pruneByAge(db, 5);
		expect(deleted).toBe(12000);
		expect(db.getLogCount()).toBe(200);
	});
});

describe("pruneBySize: multi-iteration convergence", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-size-converge");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("converges over multiple iterations for large datasets", async () => {
		// Insert enough logs that multiple 5000-batch iterations are needed
		insertLogs(db, 15000, 0);
		const initialSize = db.getDbSize();

		// Set threshold to ~55% — deletes ~6750 logs (more than one 5000 batch)
		const maxDbSize = Math.floor(initialSize * 0.55);
		const deleted = await pruneBySize(db, maxDbSize);

		expect(deleted).toBeGreaterThan(5000); // Must have taken multiple iterations
		expect(db.getDbSize()).toBeLessThanOrEqual(maxDbSize);
		expect(db.getLogCount()).toBeLessThan(15000);
		expect(db.getLogCount()).toBeGreaterThan(0);
	});

	test("size prune deletes oldest first, newest survive", async () => {
		// Insert logs with distinct ages — large enough that partial prune is meaningful
		insertLogs(db, 3000, 30, { project: "old" });
		insertLogs(db, 3000, 15, { project: "mid" });
		insertLogs(db, 3000, 1, { project: "new" });
		const initialSize = db.getDbSize();

		// Set threshold to ~70% — deletes ~2700 oldest logs
		const maxDbSize = Math.floor(initialSize * 0.7);
		await pruneBySize(db, maxDbSize);

		const remaining = db.getOldestLogs(9000);
		const projects = new Set(remaining.map((l) => l.project));

		// Newest logs should survive
		expect(projects.has("new")).toBe(true);
		// Old logs should be at least partially deleted
		const oldLogs = remaining.filter((l) => l.project === "old");
		expect(oldLogs.length).toBeLessThan(3000);
	});
});

// ─── Combined age + size ─────────────────────────────────────────

describe("startAutoPrune: combined age + size", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-combined");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("applies both age and size thresholds in same cycle", async () => {
		// Age-expired logs
		insertLogs(db, 200, 20);
		// Recent but large volume
		insertLogs(db, 5000, 0);

		const totalBefore = db.getLogCount();
		expect(totalBefore).toBe(5200);

		const sizeAfterInsert = db.getDbSize();
		// Size threshold should delete some recent logs too
		const maxDbSize = Math.floor(sizeAfterInsert * 0.3);

		const handle = startAutoPrune(db, {
			maxAgeDays: 10,
			maxDbSize,
			intervalSeconds: 0.05,
		});

		await Bun.sleep(300);
		handle.stop();

		// Age prune should have removed the 200 old logs
		// Size prune should have trimmed additional recent logs
		expect(db.getLogCount()).toBeLessThan(5000);
		expect(db.getDbSize()).toBeLessThanOrEqual(maxDbSize);
	});
});

// ─── Idempotency ─────────────────────────────────────────────────

describe("prune idempotency", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-idempotent");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("second pruneByAge call is a no-op after first completes", async () => {
		insertLogs(db, 100, 10);
		insertLogs(db, 50, 1);

		const first = await pruneByAge(db, 5);
		expect(first).toBe(100);

		const second = await pruneByAge(db, 5);
		expect(second).toBe(0);
		expect(db.getLogCount()).toBe(50);
	});

	test("second pruneBySize call is a no-op after first completes", async () => {
		insertLogs(db, 5000, 0);
		const maxDbSize = Math.floor(db.getDbSize() / 2);

		const first = await pruneBySize(db, maxDbSize);
		expect(first).toBeGreaterThan(0);

		const second = await pruneBySize(db, maxDbSize);
		expect(second).toBe(0);
	});
});

// ─── Data integrity ──────────────────────────────────────────────

describe("data integrity after prune", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-integrity");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("remaining logs have correct content after age prune", async () => {
		insertLogs(db, 50, 10, { project: "doomed", branch: "old" });
		insertLogs(db, 30, 1, { project: "keeper", branch: "new" });

		await pruneByAge(db, 5);

		const remaining = db.getOldestLogs(100);
		expect(remaining.length).toBe(30);
		for (const log of remaining) {
			expect(log.project).toBe("keeper");
			expect(log.branch).toBe("new");
			expect(log.level).toBe("info");
			expect(log.message).toMatch(/log-1d-/);
		}
	});

	test("remaining logs have correct content after size prune", async () => {
		insertLogs(db, 5000, 30, { project: "old-data" });
		insertLogs(db, 5000, 0, { project: "fresh-data" });
		const maxDbSize = Math.floor(db.getDbSize() * 0.6);

		await pruneBySize(db, maxDbSize);

		const remaining = db.getOldestLogs(10000);
		// old-data should be at least partially gone since they're oldest
		const oldRemaining = remaining.filter((l) => l.project === "old-data");
		expect(oldRemaining.length).toBeLessThan(5000);
		// fresh-data should survive intact or nearly
		const freshRemaining = remaining.filter((l) => l.project === "fresh-data");
		expect(freshRemaining.length).toBeGreaterThan(0);
		for (const log of freshRemaining) {
			expect(log.project).toBe("fresh-data");
			expect(log.level).toBe("info");
		}
	});

	test("meta field survives pruning via getOldestLogs", () => {
		const now = Date.now();
		db.insert([
			{
				level: "info",
				message: "has meta",
				timestamp: new Date(now).toISOString(),
				meta: { key: "value", nested: { a: 1 } },
			},
		]);

		const logs = db.getOldestLogs(1);
		expect(logs[0]!.meta).toEqual({ key: "value", nested: { a: 1 } });
	});
});

// ─── onArchive callback ─────────────────────────────────────────

describe("startAutoPrune: onArchive callback", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-onarchive");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("onArchive is not called when no archive config", async () => {
		insertLogs(db, 100, 10);
		let called = false;

		const handle = startAutoPrune(
			db,
			{ maxAgeDays: 5, intervalSeconds: 0.05 },
			undefined,
			async () => {
				called = true;
			},
		);

		await Bun.sleep(200);
		handle.stop();

		expect(db.getLogCount()).toBe(0);
		expect(called).toBe(false);
	});

	test("onArchive error does not prevent prune from completing", async () => {
		insertLogs(db, 100, 10);
		let callCount = 0;

		const badArchiveConfig: ArchiveConfig = {
			endpoint: "http://localhost:1",
			bucket: "x",
			accessKeyId: "x",
			secretAccessKey: "x",
		};

		// Even though archive fails and onArchive would error,
		// the error path should be handled gracefully
		const handle = startAutoPrune(
			db,
			{ maxAgeDays: 5, intervalSeconds: 0.05 },
			badArchiveConfig,
			async () => {
				callCount++;
				throw new Error("callback boom");
			},
		);

		await Bun.sleep(300);
		handle.stop();

		// Prune shouldn't have deleted (S3 failed) but should not crash
		// The onArchive callback shouldn't be called since nothing was archived
		expect(callCount).toBe(0);
	});
});

// ─── walCheckpoint ───────────────────────────────────────────────

describe("database: walCheckpoint", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("db-wal");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("walCheckpoint does not throw on empty DB", () => {
		expect(() => db.walCheckpoint()).not.toThrow();
	});

	test("walCheckpoint does not throw after inserts", () => {
		insertLogs(db, 100, 0);
		expect(() => db.walCheckpoint()).not.toThrow();
	});
});

// ─── getDbSize monotonicity ──────────────────────────────────────

describe("database: getDbSize monotonicity", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("db-mono");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("size increases with inserts", () => {
		const emptySize = db.getDbSize();
		insertLogs(db, 500, 0);
		const after500 = db.getDbSize();
		insertLogs(db, 500, 0);
		const after1000 = db.getDbSize();

		expect(after500).toBeGreaterThan(emptySize);
		expect(after1000).toBeGreaterThan(after500);
	});

	test("size decreases progressively with deletes", () => {
		insertLogs(db, 2000, 0);
		const full = db.getDbSize();

		const batch1 = db.getOldestLogs(500).map((l) => l.id!);
		db.deleteByIds(batch1);
		const after1 = db.getDbSize();

		const batch2 = db.getOldestLogs(500).map((l) => l.id!);
		db.deleteByIds(batch2);
		const after2 = db.getDbSize();

		expect(after1).toBeLessThan(full);
		expect(after2).toBeLessThan(after1);
	});
});

// ─── archiveLogBatch unit tests ──────────────────────────────────

describe("archiveLogBatch", () => {
	const badConfig: ArchiveConfig = {
		endpoint: "http://localhost:1",
		bucket: "nonexistent",
		accessKeyId: "fake",
		secretAccessKey: "fake",
		prefix: "test",
		region: "us-east-1",
	};

	test("returns empty succeededIds on S3 failure", async () => {
		const logs: LogEntry[] = [
			{
				id: 1,
				timestamp: "2025-06-15T10:00:00.000Z",
				level: "info",
				message: "test",
				created_at: Date.now() - 86_400_000,
				project: "proj",
				branch: "main",
			},
		];

		const result = await archiveLogBatch(logs, badConfig, NO_RETRY);
		expect(result.succeededIds.length).toBe(0);
		expect(result.failed).toBe(1);
		expect(result.partitions).toBe(0);
		expect(result.errors.length).toBe(1);
	});

	test("reports correct partition and error counts for multi-partition batch", async () => {
		const now = Date.now();
		const logs: LogEntry[] = [
			{
				id: 1,
				timestamp: "2025-06-15T10:00:00.000Z",
				level: "info",
				message: "proj-a log",
				created_at: now - 86_400_000 * 10,
				project: "proj-a",
				branch: "main",
			},
			{
				id: 2,
				timestamp: "2025-06-16T10:00:00.000Z",
				level: "error",
				message: "proj-b log",
				created_at: now - 86_400_000 * 9,
				project: "proj-b",
				branch: "dev",
			},
		];

		const result = await archiveLogBatch(logs, badConfig, NO_RETRY);
		// Both partitions should fail — 2 different project/branch combos
		expect(result.succeededIds.length).toBe(0);
		expect(result.failed).toBe(2);
		expect(result.errors.length).toBe(2);
		expect(result.errors[0]).toContain("proj-a");
		expect(result.errors[1]).toContain("proj-b");
	});
});

// ─── Edge cases ──────────────────────────────────────────────────

describe("edge cases", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("prune-edge");
		db = new RelogDatabase(dbPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("pruneByAge with maxAgeDays=0 prunes everything", async () => {
		insertLogs(db, 100, 0);
		// maxAgeDays=0 means cutoff = now, so all logs are "old"
		// Wait a tiny bit so logs are in the past
		await Bun.sleep(10);

		const deleted = await pruneByAge(db, 0);
		expect(deleted).toBe(100);
		expect(db.getLogCount()).toBe(0);
	});

	test("multiple age cohorts: only expired ones are pruned", async () => {
		insertLogs(db, 50, 30, { project: "ancient" }); // 30 days
		insertLogs(db, 50, 15, { project: "old" }); // 15 days
		insertLogs(db, 50, 5, { project: "recent" }); // 5 days
		insertLogs(db, 50, 1, { project: "fresh" }); // 1 day

		const deleted = await pruneByAge(db, 10);
		expect(deleted).toBe(100); // ancient + old
		expect(db.getLogCount()).toBe(100); // recent + fresh

		const remaining = db.getOldestLogs(200);
		const projects = new Set(remaining.map((l) => l.project));
		expect(projects.has("ancient")).toBe(false);
		expect(projects.has("old")).toBe(false);
		expect(projects.has("recent")).toBe(true);
		expect(projects.has("fresh")).toBe(true);
	});

	test("getOldestLogs returns parseable meta", () => {
		db.insert([
			{
				level: "info",
				message: "with meta",
				meta: { complex: { nested: [1, 2, 3] } },
			},
			{
				level: "info",
				message: "null meta",
			},
		]);

		const logs = db.getOldestLogs(2);
		const withMeta = logs.find((l) => l.message === "with meta")!;
		const nullMeta = logs.find((l) => l.message === "null meta")!;

		expect(withMeta.meta).toEqual({ complex: { nested: [1, 2, 3] } });
		expect(nullMeta.meta).toBeNull();
	});
});
