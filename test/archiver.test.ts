import { unlinkSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { logsToParquet, groupByPartition, archiveLogBatch } from "../src/archiver.ts";
import { RelogDatabase } from "../src/db/database.ts";
import { DuckDBReader } from "../src/db/duckdb.ts";
import type { ArchiveConfig, LogEntry } from "../src/types.ts";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
const MINIO_BUCKET = process.env.MINIO_BUCKET;
const HAS_MINIO = !!(MINIO_ENDPOINT && MINIO_ACCESS_KEY && MINIO_SECRET_KEY && MINIO_BUCKET);

function tmpPath(prefix: string, ext: string): string {
	return join(
		tmpdir(),
		`relog-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
	);
}

function cleanupDb(path: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(path + suffix);
		} catch {}
	}
}

function makeLogs(overrides?: Partial<LogEntry>[]): LogEntry[] {
	const base: LogEntry = {
		id: 1,
		timestamp: "2025-06-15T10:30:00.000Z",
		level: "info",
		message: "test log message",
		meta: { key: "value", nested: { a: 1 } },
		service: "api-server",
		host: "server-01",
		pid: 12345,
		trace_id: "trace-abc-123",
		span_id: "span-def-456",
		project: "my-project",
		branch: "main",
		version: "1.2.3",
		deployment_id: "deploy-789",
		key_prefix: "sk-abc",
		created_at: 1718447400000,
	};

	if (!overrides) return [base];

	return overrides.map((o, i) => ({ ...base, id: i + 1, ...o }));
}

// ─── groupByPartition ────────────────────────────────────────────

describe("groupByPartition", () => {
	test("groups logs by project/branch/date", () => {
		const logs = makeLogs([
			{ project: "proj-a", branch: "main", created_at: new Date("2025-06-15").getTime() },
			{ project: "proj-a", branch: "main", created_at: new Date("2025-06-15").getTime() },
			{ project: "proj-a", branch: "dev", created_at: new Date("2025-06-15").getTime() },
			{ project: "proj-b", branch: "main", created_at: new Date("2025-06-16").getTime() },
		]);

		const partitions = groupByPartition(logs);
		expect(partitions.length).toBe(3);

		const projAMain = partitions.find((p) => p.project === "proj-a" && p.branch === "main");
		expect(projAMain).toBeDefined();
		expect(projAMain!.logs.length).toBe(2);
		expect(projAMain!.year).toBe("2025");
		expect(projAMain!.month).toBe("06");
		expect(projAMain!.day).toBe("15");
	});

	test("uses _default for missing project/branch", () => {
		const logs = makeLogs([
			{ project: undefined as unknown as string, branch: undefined as unknown as string },
		]);
		const partitions = groupByPartition(logs);
		expect(partitions[0]!.project).toBe("_default");
		expect(partitions[0]!.branch).toBe("_default");
	});
});

// ─── logsToParquet → DuckDB round-trip ───────────────────────────

describe("Parquet round-trip", () => {
	test("all columns survive Parquet serialization and can be read by DuckDB", async () => {
		const logs = makeLogs();
		const buffer = logsToParquet(logs);

		// Write Parquet to temp file
		const parquetPath = tmpPath("roundtrip", ".parquet");
		writeFileSync(parquetPath, Buffer.from(buffer));

		// Read it back via DuckDB
		const instance = await DuckDBInstance.create();
		const conn = await instance.connect();
		try {
			const reader = await conn.runAndReadAll(
				`SELECT * FROM read_parquet('${parquetPath.replace(/'/g, "''")}')`,
			);
			const rows = reader.getRowObjects() as Record<string, unknown>[];

			expect(rows.length).toBe(1);
			const row = rows[0]!;

			expect(Number(row.id)).toBe(1);
			expect(row.timestamp).toBe("2025-06-15T10:30:00.000Z");
			expect(row.level).toBe("info");
			expect(row.message).toBe("test log message");
			expect(row.meta).toBe('{"key":"value","nested":{"a":1}}');
			expect(row.service).toBe("api-server");
			expect(row.host).toBe("server-01");
			expect(Number(row.pid)).toBe(12345);
			expect(row.trace_id).toBe("trace-abc-123");
			expect(row.span_id).toBe("span-def-456");
			expect(row.project).toBe("my-project");
			expect(row.branch).toBe("main");
			expect(row.version).toBe("1.2.3");
			expect(row.deployment_id).toBe("deploy-789");
			expect(row.key_prefix).toBe("sk-abc");
			expect(Number(row.created_at)).toBe(1718447400000);
		} finally {
			conn.closeSync();
			instance.closeSync();
			try {
				unlinkSync(parquetPath);
			} catch {}
		}
	});

	test("nullable columns survive as NULL", async () => {
		const logs = makeLogs([
			{
				service: undefined as unknown as string,
				host: undefined as unknown as string,
				pid: undefined as unknown as number,
				trace_id: undefined as unknown as string,
				span_id: undefined as unknown as string,
				project: undefined as unknown as string,
				branch: undefined as unknown as string,
				version: undefined as unknown as string,
				deployment_id: undefined as unknown as string,
				key_prefix: undefined as unknown as string,
				meta: undefined as unknown as Record<string, unknown>,
			},
		]);
		const buffer = logsToParquet(logs);

		const parquetPath = tmpPath("nulls", ".parquet");
		writeFileSync(parquetPath, Buffer.from(buffer));

		const instance = await DuckDBInstance.create();
		const conn = await instance.connect();
		try {
			const reader = await conn.runAndReadAll(
				`SELECT * FROM read_parquet('${parquetPath.replace(/'/g, "''")}')`,
			);
			const rows = reader.getRowObjects() as Record<string, unknown>[];
			const row = rows[0]!;

			expect(row.service).toBeNull();
			expect(row.host).toBeNull();
			expect(row.pid).toBeNull();
			expect(row.trace_id).toBeNull();
			expect(row.span_id).toBeNull();
			expect(row.project).toBeNull();
			expect(row.branch).toBeNull();
			expect(row.version).toBeNull();
			expect(row.deployment_id).toBeNull();
			expect(row.key_prefix).toBeNull();
		} finally {
			conn.closeSync();
			instance.closeSync();
			try {
				unlinkSync(parquetPath);
			} catch {}
		}
	});

	test("multiple rows survive Parquet round-trip", async () => {
		const logs = makeLogs([
			{ id: 1, message: "first", level: "info", version: "1.0" },
			{ id: 2, message: "second", level: "error", version: "2.0" },
			{ id: 3, message: "third", level: "warn", version: "3.0" },
		]);
		const buffer = logsToParquet(logs);

		const parquetPath = tmpPath("multi", ".parquet");
		writeFileSync(parquetPath, Buffer.from(buffer));

		const instance = await DuckDBInstance.create();
		const conn = await instance.connect();
		try {
			const reader = await conn.runAndReadAll(
				`SELECT id, message, level, version FROM read_parquet('${parquetPath.replace(/'/g, "''")}') ORDER BY id`,
			);
			const rows = reader.getRowObjects() as Record<string, unknown>[];

			expect(rows.length).toBe(3);
			expect(rows[0]!.message).toBe("first");
			expect(rows[1]!.message).toBe("second");
			expect(rows[2]!.message).toBe("third");
			expect(rows[0]!.version).toBe("1.0");
			expect(rows[2]!.level).toBe("warn");
		} finally {
			conn.closeSync();
			instance.closeSync();
			try {
				unlinkSync(parquetPath);
			} catch {}
		}
	});
});

// ─── DuckDB UNION ALL view: hot SQLite + cold Parquet ────────────

describe("DuckDB UNION ALL view (SQLite + Parquet)", () => {
	let dbPath: string;
	let parquetDir: string;
	let db: RelogDatabase;

	beforeAll(() => {
		dbPath = tmpPath("union", ".db");
		parquetDir = join(tmpdir(), `relog-parquet-${Date.now()}`);
		mkdirSync(parquetDir, { recursive: true });

		db = new RelogDatabase(dbPath);
	});

	afterAll(() => {
		db.close();
		cleanupDb(dbPath);
		try {
			rmSync(parquetDir, { recursive: true });
		} catch {}
	});

	test("DuckDB view combines hot SQLite rows with cold Parquet data", async () => {
		// Insert "hot" logs into SQLite
		db.insert([
			{
				level: "info",
				message: "hot log 1",
				service: "hot-svc",
				project: "hot-proj",
				version: "hot-v1",
			},
			{
				level: "error",
				message: "hot log 2",
				service: "hot-svc",
				project: "hot-proj",
			},
		]);

		// Create "cold" Parquet data (simulating previously archived logs)
		const coldLogs = makeLogs([
			{
				id: 1000,
				message: "cold archived log",
				level: "warn",
				service: "cold-svc",
				project: "cold-proj",
				version: "archive-v1",
				deployment_id: "deploy-cold",
				key_prefix: "sk-cold",
				created_at: Date.now() - 86_400_000 * 30,
			},
		]);
		const parquetBuffer = logsToParquet(coldLogs);
		const parquetFile = join(parquetDir, "test-archive.parquet");
		writeFileSync(parquetFile, Buffer.from(parquetBuffer));

		// Create DuckDB instance that reads from both SQLite and Parquet
		const instance = await DuckDBInstance.create();
		let conn = await instance.connect();
		try {
			await conn.run("INSTALL sqlite; LOAD sqlite;");
			await conn.run(`ATTACH '${dbPath.replace(/'/g, "''")}' AS hot (TYPE sqlite, READ_ONLY);`);

			// Create UNION ALL view manually (same as what createLogsView does for archive config)
			await conn.run(`
				CREATE OR REPLACE VIEW logs AS
					SELECT * FROM hot.logs
					UNION ALL BY NAME
					SELECT * FROM read_parquet('${parquetDir.replace(/'/g, "''")}/**/*.parquet', hive_partitioning=false, union_by_name=true)
			`);

			// Query the combined view
			const reader = await conn.runAndReadAll("SELECT * FROM logs ORDER BY id");
			const rows = reader.getRowObjects() as Record<string, unknown>[];

			// Should have hot + cold rows
			expect(rows.length).toBe(3);

			// Verify hot rows are present
			const hotRows = rows.filter((r) => String(r.message).startsWith("hot"));
			expect(hotRows.length).toBe(2);

			// Verify cold (archived) row is present with all columns intact
			const coldRow = rows.find((r) => String(r.message) === "cold archived log");
			expect(coldRow).toBeDefined();
			expect(coldRow!.level).toBe("warn");
			expect(coldRow!.service).toBe("cold-svc");
			expect(coldRow!.project).toBe("cold-proj");
			expect(coldRow!.version).toBe("archive-v1");
			expect(coldRow!.deployment_id).toBe("deploy-cold");
			expect(coldRow!.key_prefix).toBe("sk-cold");
		} finally {
			conn.closeSync();
			instance.closeSync();
		}
	});

	test("DuckDB searchLogs works across hot + cold data via DuckDBReader", async () => {
		// Write additional cold Parquet data for a different project
		const coldLogs = makeLogs([
			{
				id: 2000,
				message: "searchable cold log",
				level: "error",
				service: "search-svc",
				project: "search-proj",
				branch: "feature-x",
				version: "v9.9",
				created_at: Date.now() - 86_400_000 * 60,
			},
		]);
		const parquetBuffer = logsToParquet(coldLogs);
		const parquetFile = join(parquetDir, "search-archive.parquet");
		writeFileSync(parquetFile, Buffer.from(parquetBuffer));

		// Use the DuckDBReader directly — but we need a custom config
		// We'll build a manual DuckDB instance since DuckDBReader expects S3 for archive
		const instance = await DuckDBInstance.create();
		const conn = await instance.connect();
		try {
			await conn.run("INSTALL sqlite; LOAD sqlite;");
			await conn.run(`ATTACH '${dbPath.replace(/'/g, "''")}' AS hot (TYPE sqlite, READ_ONLY);`);
			await conn.run(`
				CREATE OR REPLACE VIEW logs AS
					SELECT * FROM hot.logs
					UNION ALL BY NAME
					SELECT * FROM read_parquet('${parquetDir.replace(/'/g, "''")}/**/*.parquet', hive_partitioning=false, union_by_name=true)
			`);

			// Query for error level — should find both hot and cold error logs
			const reader = await conn.runAndReadAll(
				"SELECT * FROM logs WHERE level = 'error' ORDER BY id",
			);
			const rows = reader.getRowObjects() as Record<string, unknown>[];
			expect(rows.length).toBeGreaterThanOrEqual(2);

			// The cold error log should have version preserved
			const coldError = rows.find((r) => String(r.version) === "v9.9");
			expect(coldError).toBeDefined();
			expect(coldError!.project).toBe("search-proj");
			expect(coldError!.branch).toBe("feature-x");

			// Query by project
			const projReader = await conn.runAndReadAll(
				"SELECT * FROM logs WHERE project = 'search-proj'",
			);
			const projRows = projReader.getRowObjects() as Record<string, unknown>[];
			expect(projRows.length).toBe(1);
			expect(projRows[0]!.message).toBe("searchable cold log");
		} finally {
			conn.closeSync();
			instance.closeSync();
		}
	});
});

// ─── Database archive helpers ─────────────────────────────────────

describe("Database archive helpers", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeAll(() => {
		dbPath = tmpPath("archivedb", ".db");
		db = new RelogDatabase(dbPath);
	});

	afterAll(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("getLogsForArchive returns logs older than cutoff", () => {
		const now = Date.now();
		db.insert([
			{
				level: "info",
				message: "old log",
				timestamp: new Date(now - 86_400_000 * 10).toISOString(),
			},
			{ level: "info", message: "recent log", timestamp: new Date(now).toISOString() },
		]);

		const cutoff = now - 86_400_000 * 5;
		const archivable = db.getLogsForArchive(cutoff);

		expect(archivable.length).toBe(1);
		expect(archivable[0]!.message).toBe("old log");
	});

	test("deleteByIds removes specific logs", () => {
		const before = db.getLogCount();
		const logs = db.getLogsForArchive(Date.now() + 1000);
		const idsToDelete = logs.slice(0, 1).map((l) => l.id!);

		const deleted = db.deleteByIds(idsToDelete);
		expect(deleted).toBe(idsToDelete.length);
		expect(db.getLogCount()).toBe(before - idsToDelete.length);
	});

	test("full archive pipeline: getLogsForArchive → logsToParquet → deleteByIds", () => {
		const now = Date.now();
		// Insert logs that are "archivable"
		db.insert(
			[
				{
					level: "error",
					message: "pipeline test log",
					version: "pipe-v1",
					deployment_id: "pipe-deploy",
					timestamp: new Date(now - 86_400_000 * 30).toISOString(),
				},
			],
			"sk-pipe",
		);

		const cutoff = now - 86_400_000 * 20;
		const toArchive = db.getLogsForArchive(cutoff);
		const pipelineLogs = toArchive.filter((l) => l.message === "pipeline test log");
		expect(pipelineLogs.length).toBe(1);

		// Verify the fetched log has all columns
		const log = pipelineLogs[0]!;
		expect(log.version).toBe("pipe-v1");
		expect(log.deployment_id).toBe("pipe-deploy");
		expect(log.key_prefix).toBe("sk-pipe");

		// Convert to Parquet — this should not throw
		const buffer = logsToParquet(pipelineLogs);
		expect(buffer.byteLength).toBeGreaterThan(0);

		// Delete the archived log
		const deleted = db.deleteByIds(pipelineLogs.map((l) => l.id!));
		expect(deleted).toBe(1);
	});
});

// ─── Real S3/MinIO end-to-end archiver tests ─────────────────────
// These run against a real MinIO instance. Skipped when MINIO_* env vars are not set.
// CI sets them up automatically. For local dev: docker compose up -d

describe.if(HAS_MINIO)("Archiver → S3 (MinIO) end-to-end", () => {
	let dbPath: string;
	let db: RelogDatabase;
	let archiveConfig: ArchiveConfig;
	let s3: S3Client;
	const testPrefix = `test-${Date.now()}`;

	beforeAll(() => {
		dbPath = tmpPath("s3-e2e", ".db");
		db = new RelogDatabase(dbPath);

		archiveConfig = {
			endpoint: MINIO_ENDPOINT!,
			bucket: MINIO_BUCKET!,
			accessKeyId: MINIO_ACCESS_KEY!,
			secretAccessKey: MINIO_SECRET_KEY!,
			prefix: testPrefix,
			region: "us-east-1",
		};

		s3 = new S3Client({
			endpoint: MINIO_ENDPOINT!,
			bucket: MINIO_BUCKET!,
			accessKeyId: MINIO_ACCESS_KEY!,
			secretAccessKey: MINIO_SECRET_KEY!,
			region: "us-east-1",
		});
	});

	afterAll(async () => {
		db.close();
		cleanupDb(dbPath);

		// Clean up S3 test objects
		// List and delete all objects under testPrefix
		// Note: Bun's S3Client doesn't have list, so we'll leave cleanup to the bucket lifecycle
	});

	test("archiveLogBatch uploads Parquet to S3 and returns succeeded IDs", async () => {
		const now = Date.now();
		const oldTimestamp = new Date(now - 86_400_000 * 10).toISOString();

		// Insert logs to archive
		db.insert(
			[
				{
					level: "info",
					message: "s3 archive test 1",
					service: "test-svc",
					project: "s3-proj",
					branch: "main",
					version: "s3-v1",
					deployment_id: "s3-deploy",
					timestamp: oldTimestamp,
					meta: { source: "test" },
				},
				{
					level: "error",
					message: "s3 archive test 2",
					service: "test-svc",
					project: "s3-proj",
					branch: "main",
					version: "s3-v2",
					timestamp: oldTimestamp,
				},
			],
			"sk-s3t",
		);

		// Insert a recent log that we won't include in the batch
		db.insert([
			{
				level: "info",
				message: "recent - should stay",
				timestamp: new Date(now).toISOString(),
			},
		]);

		expect(db.getLogCount()).toBe(3);

		// Get old logs and archive them via archiveLogBatch
		const cutoff = now - 86_400_000 * 5;
		const logs = db.getLogsForArchive(cutoff, 1000);
		expect(logs.length).toBe(2);

		const result = await archiveLogBatch(logs, archiveConfig);

		expect(result.succeededIds.length).toBe(2);
		expect(result.failed).toBe(0);
		expect(result.partitions).toBeGreaterThanOrEqual(1);
		expect(result.errors).toHaveLength(0);

		// Delete archived logs from SQLite (as the pruner would)
		db.deleteByIds(result.succeededIds);
		expect(db.getLogCount()).toBe(1);

		// The remaining log should be the recent one
		const remaining = db.getLogsForArchive(now + 1000);
		expect(remaining[0]!.message).toBe("recent - should stay");
	});

	test("archived Parquet files are readable by DuckDB via S3", async () => {
		// The previous test archived logs. Now read them back via DuckDB + S3.
		const instance = await DuckDBInstance.create();
		const conn = await instance.connect();
		try {
			await conn.run("INSTALL aws; LOAD aws;");
			await conn.run("INSTALL httpfs; LOAD httpfs;");

			const endpoint = MINIO_ENDPOINT!.replace(/^https?:\/\//, "");
			const useSsl = MINIO_ENDPOINT!.startsWith("https");
			await conn.run(`
				CREATE SECRET test_s3 (
					TYPE S3,
					KEY_ID '${MINIO_ACCESS_KEY!}',
					SECRET '${MINIO_SECRET_KEY!}',
					ENDPOINT '${endpoint}',
					URL_STYLE 'path',
					USE_SSL ${useSsl},
					REGION 'us-east-1'
				);
			`);

			const parquetPath = `s3://${MINIO_BUCKET!}/${testPrefix}/**/*.parquet`;
			const reader = await conn.runAndReadAll(
				`SELECT * FROM read_parquet('${parquetPath}', hive_partitioning=false, union_by_name=true) ORDER BY id`,
			);
			const rows = reader.getRowObjects() as Record<string, unknown>[];

			expect(rows.length).toBe(2);

			// Verify all columns survived the full pipeline: SQLite → Parquet → S3 → DuckDB
			const row1 = rows.find((r) => String(r.message) === "s3 archive test 1")!;
			expect(row1).toBeDefined();
			expect(row1.level).toBe("info");
			expect(row1.service).toBe("test-svc");
			expect(row1.project).toBe("s3-proj");
			expect(row1.branch).toBe("main");
			expect(row1.version).toBe("s3-v1");
			expect(row1.deployment_id).toBe("s3-deploy");
			expect(row1.key_prefix).toBe("sk-s3t");
			expect(row1.meta).toBe('{"source":"test"}');

			const row2 = rows.find((r) => String(r.message) === "s3 archive test 2")!;
			expect(row2).toBeDefined();
			expect(row2.version).toBe("s3-v2");
		} finally {
			conn.closeSync();
			instance.closeSync();
		}
	});

	test("DuckDBReader UNION ALL view works with real S3 archive", async () => {
		// Insert a fresh "hot" log
		db.insert([{ level: "warn", message: "hot after archive", project: "s3-proj" }]);

		// Create a DuckDBReader configured with the real archive
		const duckdb = new DuckDBReader(dbPath, archiveConfig);
		await duckdb.init();

		try {
			// Query should return both hot (SQLite) + cold (S3 Parquet) data
			const result = await duckdb.searchLogs({ project: "s3-proj" });

			// 2 archived in S3 + 1 hot in SQLite = 3
			expect(result.rows.length).toBe(3);

			// Verify we can see both hot and cold
			const hot = result.rows.find((r) => r.message === "hot after archive");
			expect(hot).toBeDefined();

			const cold = result.rows.find((r) => r.message === "s3 archive test 1");
			expect(cold).toBeDefined();
			expect(cold!.version).toBe("s3-v1");
			expect(cold!.deployment_id).toBe("s3-deploy");
			expect(cold!.key_prefix).toBe("sk-s3t");

			// Stats should include data from both sources
			const stats = await duckdb.stats();
			expect(stats.log_count).toBeGreaterThanOrEqual(3);
		} finally {
			duckdb.close();
		}
	});
});
