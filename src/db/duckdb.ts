import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { ArchiveConfig, LogEntry, QueryResult } from "../types.ts";
import { validateQuery } from "./validate.ts";
import { parseMeta } from "./util.ts";
import type { SearchOptions } from "./database.ts";

function escapeLike(s: string): string {
	return s.replace(/[%_\\]/g, "\\$&");
}

function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		out[k] = typeof v === "bigint" ? Number(v) : v;
	}
	return out;
}

/** Escape a string value for safe interpolation in SQL single quotes. */
function escapeString(s: string): string {
	return s.replace(/'/g, "''");
}

export class DuckDBReader {
	private instance: DuckDBInstance | null = null;
	private sqlitePath: string;
	private archive?: ArchiveConfig;

	constructor(sqlitePath: string, archive?: ArchiveConfig) {
		this.sqlitePath = sqlitePath;
		this.archive = archive;
	}

	/** Get a fresh connection for each operation (safe for concurrency). */
	private async connect(): Promise<DuckDBConnection> {
		if (!this.instance) throw new Error("DuckDB not initialized");
		return this.instance.connect();
	}

	async init(): Promise<void> {
		const instance = await DuckDBInstance.create();
		let conn: DuckDBConnection | null = null;

		try {
			conn = await instance.connect();
			await conn.run("INSTALL sqlite; LOAD sqlite;");
			await conn.run(`ATTACH '${escapeString(this.sqlitePath)}' AS hot (TYPE sqlite, READ_ONLY);`);

			if (this.archive) {
				await conn.run("INSTALL httpfs; LOAD httpfs;");

				const endpoint = this.archive.endpoint.replace(/^https?:\/\//, "");
				await conn.run(`SET s3_endpoint = '${escapeString(endpoint)}';`);
				await conn.run(`SET s3_access_key_id = '${escapeString(this.archive.accessKeyId)}';`);
				await conn.run(
					`SET s3_secret_access_key = '${escapeString(this.archive.secretAccessKey)}';`,
				);
				await conn.run(`SET s3_region = '${escapeString(this.archive.region ?? "us-east-1")}';`);
				await conn.run("SET s3_url_style = 'path';");
				await conn.run(
					`SET s3_use_ssl = ${this.archive.endpoint.startsWith("https") ? "true" : "false"};`,
				);

				await this.createLogsView(conn);
			} else {
				await conn.run("CREATE OR REPLACE VIEW logs AS SELECT * FROM hot.logs");
			}
			// Only assign instance after full success
			this.instance = instance;
		} catch (err) {
			instance.closeSync();
			throw err;
		} finally {
			conn?.closeSync();
		}
	}

	private async createLogsView(conn: DuckDBConnection): Promise<void> {
		if (!this.archive) {
			await conn.run("CREATE OR REPLACE VIEW logs AS SELECT * FROM hot.logs");
			return;
		}
		const bucket = escapeString(this.archive.bucket);
		const prefix = escapeString(this.archive.prefix ?? "logs");
		const parquetPath = `s3://${bucket}/${prefix}/**/*.parquet`;

		await conn.run(`
			CREATE OR REPLACE VIEW logs AS
				SELECT * FROM hot.logs
				UNION ALL
				SELECT id, timestamp, level, message, meta, service, host, pid,
					trace_id, span_id, project, branch, created_at
				FROM read_parquet('${parquetPath}', hive_partitioning=false, union_by_name=true)
		`);
	}

	/** Recreate the logs view so newly archived Parquet files become visible. */
	async refreshView(): Promise<void> {
		const conn = await this.connect();
		try {
			await this.createLogsView(conn);
		} finally {
			conn.closeSync();
		}
	}

	async query(sql: string, params?: unknown[], maxRows: number = 10000): Promise<QueryResult> {
		const safeSql = validateQuery(sql, maxRows);
		const conn = await this.connect();
		try {
			const start = performance.now();
			const reader =
				params && params.length > 0
					? await conn.runAndReadAll(safeSql, params as (string | number | boolean | null)[])
					: await conn.runAndReadAll(safeSql);
			const rawRows = reader.getRowObjects() as Record<string, unknown>[];
			const rows = rawRows.map(coerceRow);
			const time_ms = Math.round((performance.now() - start) * 100) / 100;
			return { rows, count: rows.length, time_ms };
		} finally {
			conn.closeSync();
		}
	}

	async *queryStream(
		sql: string,
		maxRows: number = 10000,
	): AsyncIterableIterator<Record<string, unknown>> {
		const safeSql = validateQuery(sql, maxRows);
		const conn = await this.connect();
		try {
			const result = await conn.stream(safeSql);
			while (true) {
				const chunk = await result.fetchChunk();
				if (!chunk || chunk.rowCount === 0) break;
				const columnNames = result.deduplicatedColumnNames();
				const rows = chunk.getRowObjects(columnNames);
				for (const row of rows) {
					yield coerceRow(row as Record<string, unknown>);
				}
			}
		} finally {
			conn.closeSync();
		}
	}

	async searchLogs(opts: SearchOptions): Promise<{ rows: LogEntry[]; total: number }> {
		const conditions: string[] = [];
		const params: (string | number | bigint)[] = [];

		for (const col of [
			"level",
			"service",
			"project",
			"branch",
			"version",
			"deployment_id",
		] as const) {
			const val = opts[col];
			if (!val) continue;
			const values = val.split(",").filter(Boolean);
			if (values.length === 1) {
				conditions.push(`${col} = ?`);
				params.push(values[0]!);
			} else if (values.length > 1) {
				conditions.push(`${col} IN (${values.map(() => "?").join(", ")})`);
				params.push(...values);
			}
		}
		if (opts.grep) {
			conditions.push("message LIKE ? ESCAPE '\\'");
			params.push(`%${escapeLike(opts.grep)}%`);
		}
		if (opts.from) {
			conditions.push("created_at >= ?");
			// Use BigInt for timestamp params — DuckDB reads created_at as BIGINT
			// from SQLite, and JS number params are interpreted as INT32
			params.push(BigInt(Math.floor(Number(opts.from))));
		}
		if (opts.to) {
			conditions.push("created_at <= ?");
			params.push(BigInt(Math.floor(Number(opts.to))));
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = opts.limit ?? 100;
		const offset = opts.offset ?? 0;

		const conn = await this.connect();
		try {
			let total = -1;
			if (opts.includeTotal !== false) {
				const countReader =
					params.length > 0
						? await conn.runAndReadAll(
								`SELECT COUNT(*) as total FROM logs ${where}`,
								params as (string | number | bigint)[],
							)
						: await conn.runAndReadAll(`SELECT COUNT(*) as total FROM logs ${where}`);
				const countRows = countReader.getRowObjects() as {
					total: number;
				}[];
				total = Number(countRows[0]?.total ?? 0);
			}

			// When around_id is specified, fetch logs centered around that ID
			let sql: string;
			let dataParams: (string | number | bigint)[];

			if (opts.around_id) {
				const contextSize = Math.floor((limit - 1) / 2);
				const conditionStr = conditions.join(" AND ");
				const wherePrefix = conditionStr ? `${conditionStr} AND ` : "";

				sql = `
					SELECT * FROM (
						SELECT * FROM logs
						WHERE ${wherePrefix}id < ?
						ORDER BY id DESC LIMIT ?
					) UNION ALL
					SELECT * FROM logs
					WHERE ${wherePrefix}id = ?
					UNION ALL
					SELECT * FROM (
						SELECT * FROM logs
						WHERE ${wherePrefix}id > ?
						ORDER BY id ASC LIMIT ?
					)
					ORDER BY id ASC
				`;
				dataParams = [
					...params,
					opts.around_id,
					contextSize,
					...params,
					opts.around_id,
					...params,
					opts.around_id,
					contextSize,
				];
			} else {
				sql = `SELECT * FROM logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`;
				dataParams = [...params, limit, offset];
			}

			const reader = await conn.runAndReadAll(sql, dataParams as (string | number | bigint)[]);
			const rawRows = reader.getRowObjects() as Record<string, unknown>[];
			const rows = rawRows.map(coerceRow) as unknown as LogEntry[];

			return {
				rows: rows.map((row) => ({ ...row, meta: parseMeta(row.meta) })),
				total,
			};
		} finally {
			conn.closeSync();
		}
	}

	async histogram(opts: {
		from: number;
		to: number;
		buckets: number;
		filters?: { level?: string; service?: string; project?: string; branch?: string };
	}): Promise<{
		buckets: {
			time: number;
			fatal: number;
			error: number;
			warn: number;
			info: number;
			debug: number;
			trace: number;
			total: number;
		}[];
		bucket_ms: number;
	}> {
		const { from, to, buckets: bucketCount } = opts;
		const rangeMs = to - from;
		const bucketMs = Math.floor(rangeMs / bucketCount);

		const conditions: string[] = ["created_at >= ?", "created_at <= ?"];
		const params: (string | number | bigint)[] = [BigInt(Math.floor(from)), BigInt(Math.floor(to))];

		if (opts.filters?.level) {
			conditions.push("level = ?");
			params.push(opts.filters.level);
		}
		if (opts.filters?.service) {
			conditions.push("service = ?");
			params.push(opts.filters.service);
		}
		if (opts.filters?.project) {
			conditions.push("project = ?");
			params.push(opts.filters.project);
		}
		if (opts.filters?.branch) {
			conditions.push("branch = ?");
			params.push(opts.filters.branch);
		}

		const where = `WHERE ${conditions.join(" AND ")}`;
		const sql = `
			SELECT
				CAST((created_at - ${Math.floor(from)}) / ${bucketMs} AS INTEGER) as bucket,
				level,
				COUNT(*) as count
			FROM logs
			${where}
			GROUP BY bucket, level
			ORDER BY bucket
			LIMIT 100000
		`;

		const conn = await this.connect();
		try {
			const reader = await conn.runAndReadAll(sql, params as (string | number | bigint)[]);
			const rows = reader.getRowObjects() as {
				bucket: number | bigint;
				level: string;
				count: number | bigint;
			}[];

			const bucketMap = new Map<
				number,
				{
					time: number;
					fatal: number;
					error: number;
					warn: number;
					info: number;
					debug: number;
					trace: number;
					total: number;
				}
			>();
			for (let i = 0; i < bucketCount; i++) {
				const time = from + i * bucketMs + bucketMs / 2;
				bucketMap.set(i, {
					time,
					fatal: 0,
					error: 0,
					warn: 0,
					info: 0,
					debug: 0,
					trace: 0,
					total: 0,
				});
			}

			for (const row of rows) {
				const idx = Number(row.bucket);
				const bucket = bucketMap.get(idx);
				if (!bucket) continue;
				const level = row.level as string;
				const count = Number(row.count);
				if (level in bucket) {
					(bucket as unknown as Record<string, unknown>)[level] = count;
				}
				bucket.total += count;
			}

			return { buckets: Array.from(bucketMap.values()), bucket_ms: bucketMs };
		} finally {
			conn.closeSync();
		}
	}

	async stats(): Promise<{
		log_count: number;
		levels: Record<string, number>;
		services: Record<string, number>;
		projects: Record<string, number>;
		versions: Record<string, number>;
	}> {
		const conn = await this.connect();
		try {
			const reader = await conn.runAndReadAll(`
				SELECT
					'level' as dim, level as key, COUNT(*) as count FROM logs GROUP BY level
				UNION ALL
				SELECT
					'service' as dim, service as key, COUNT(*) as count FROM logs WHERE service IS NOT NULL GROUP BY service
				UNION ALL
				SELECT
					'project' as dim, project as key, COUNT(*) as count FROM logs WHERE project IS NOT NULL GROUP BY project
				UNION ALL
				SELECT
					'version' as dim, version as key, COUNT(*) as count FROM logs WHERE version IS NOT NULL GROUP BY version
			`);
			const rows = reader.getRowObjects() as { dim: string; key: string; count: number }[];

			const levels: Record<string, number> = {};
			const services: Record<string, number> = {};
			const projects: Record<string, number> = {};
			const versions: Record<string, number> = {};
			let totalCount = 0;

			for (const row of rows) {
				const count = Number(row.count);
				if (row.dim === "level") {
					levels[row.key] = count;
					totalCount += count;
				} else if (row.dim === "service") {
					services[row.key] = count;
				} else if (row.dim === "project") {
					projects[row.key] = count;
				} else {
					versions[row.key] = count;
				}
			}

			return { log_count: totalCount, levels, services, projects, versions };
		} finally {
			conn.closeSync();
		}
	}

	close(): void {
		if (this.instance) {
			this.instance.closeSync();
			this.instance = null;
		}
	}
}
