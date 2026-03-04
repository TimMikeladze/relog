import { Database, type SQLQueryBindings } from "bun:sqlite";
import { CREATE_INDEXES, CREATE_LOGS_TABLE } from "./schema.ts";
import type { IngestPayload, LogEntry, QueryResult, StreamFilters } from "../types.ts";

const BLOCKED_KEYWORDS =
	/\b(ATTACH|DETACH|LOAD_EXTENSION|REINDEX|VACUUM|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE|GRANT|REVOKE)\b/i;
const SAFE_PRAGMAS = new Set([
	"table_info",
	"table_list",
	"index_list",
	"index_info",
	"database_list",
	"compile_options",
	"page_count",
	"page_size",
	"freelist_count",
	"max_page_count",
	"data_version",
	"encoding",
]);

export class QueryValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QueryValidationError";
	}
}

function skipQuoted(sql: string, i: number, quote: string): number {
	i++;
	while (i < sql.length) {
		if (sql[i] === quote && sql[i + 1] === quote) {
			i += 2;
		} else if (sql[i] === quote) {
			i++;
			break;
		} else {
			i++;
		}
	}
	return i;
}

function stripSqlComments(sql: string): string {
	let result = "";
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "'" || sql[i] === '"') {
			const start = i;
			i = skipQuoted(sql, i, sql[i]!);
			result += sql.slice(start, i);
		} else if (sql[i] === "-" && sql[i + 1] === "-") {
			while (i < sql.length && sql[i] !== "\n") i++;
		} else if (sql[i] === "/" && sql[i + 1] === "*") {
			i += 2;
			while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
			i += 2;
		} else {
			result += sql[i];
			i++;
		}
	}
	return result.trim();
}

function blankQuotedStrings(sql: string): string {
	let result = "";
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "'" || sql[i] === '"') {
			const quote = sql[i]!;
			result += quote;
			i++;
			while (i < sql.length) {
				if (sql[i] === quote && sql[i + 1] === quote) {
					i += 2;
				} else if (sql[i] === quote) {
					result += quote;
					i++;
					break;
				} else {
					i++;
				}
			}
		} else {
			result += sql[i];
			i++;
		}
	}
	return result;
}

function hasSemicolonOutsideQuotes(sql: string): boolean {
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "'" || sql[i] === '"') {
			i = skipQuoted(sql, i, sql[i]!);
		} else if (sql[i] === ";") {
			return true;
		} else {
			i++;
		}
	}
	return false;
}

export interface SearchOptions {
	level?: string;
	service?: string;
	project?: string;
	branch?: string;
	grep?: string;
	from?: number;
	to?: number;
	limit?: number;
	offset?: number;
	includeTotal?: boolean;
}

function parseMeta(raw: unknown): Record<string, unknown> | undefined {
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return { _raw: raw };
		}
	}
	return raw as Record<string, unknown> | undefined;
}

function escapeLike(s: string): string {
	return s.replace(/[%_\\]/g, "\\$&");
}

export class RelogDatabase {
	private db: Database;
	private readonlyDb: Database;

	constructor(path: string = "relog.db") {
		this.db = new Database(path, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec(CREATE_LOGS_TABLE);
		// Migrate: add project/branch columns for existing DBs
		try {
			this.db.exec("ALTER TABLE logs ADD COLUMN project TEXT");
		} catch {}
		try {
			this.db.exec("ALTER TABLE logs ADD COLUMN branch TEXT");
		} catch {}
		for (const idx of CREATE_INDEXES) {
			this.db.exec(idx);
		}

		this.readonlyDb = new Database(path, {
			readonly: true,
			create: false,
		});
		this.readonlyDb.exec("PRAGMA busy_timeout = 5000");
	}

	insert(entries: IngestPayload[]): void {
		const stmt = this.db.prepare(`
      INSERT INTO logs (timestamp, level, message, meta, service, host, pid, trace_id, span_id, project, branch, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		const now = Date.now();
		this.db.transaction(() => {
			for (const entry of entries) {
				let ts: string;
				let createdAt: number;

				if (entry.timestamp) {
					const parsed = new Date(entry.timestamp).getTime();
					if (Number.isNaN(parsed)) {
						console.warn(`[relog.dev] Invalid timestamp "${entry.timestamp}", using server time`);
						ts = new Date(now).toISOString();
						createdAt = now;
					} else {
						ts = entry.timestamp;
						createdAt = parsed;
					}
				} else {
					ts = new Date(now).toISOString();
					createdAt = now;
				}
				stmt.run(
					ts,
					entry.level,
					entry.message,
					entry.meta ? JSON.stringify(entry.meta) : null,
					entry.service ?? null,
					entry.host ?? null,
					entry.pid ?? null,
					entry.trace_id ?? null,
					entry.span_id ?? null,
					entry.project ?? null,
					entry.branch ?? null,
					createdAt,
				);
			}
		})();
	}

	private validateAndPrepare(sql: string, maxRows: number): string {
		if (typeof sql !== "string") {
			throw new QueryValidationError("SQL must be a string");
		}

		const stripped = stripSqlComments(sql);

		if (hasSemicolonOutsideQuotes(stripped)) {
			throw new QueryValidationError("Multiple statements are not allowed");
		}

		const blanked = blankQuotedStrings(stripped);

		if (BLOCKED_KEYWORDS.test(blanked)) {
			throw new QueryValidationError("Statement contains a blocked keyword");
		}

		const trimmed = blanked.toUpperCase().trimStart();
		if (
			!trimmed.startsWith("SELECT") &&
			!trimmed.startsWith("EXPLAIN") &&
			!trimmed.startsWith("PRAGMA")
		) {
			throw new QueryValidationError("Only SELECT, EXPLAIN, and PRAGMA queries are allowed");
		}

		if (trimmed.startsWith("PRAGMA")) {
			const match = stripped.match(/^PRAGMA\s+(\w+)/i);
			const pragmaName = match?.[1]?.toLowerCase();
			if (!pragmaName || !SAFE_PRAGMAS.has(pragmaName)) {
				throw new QueryValidationError("Only read-only PRAGMAs are allowed");
			}
		}

		if (trimmed.startsWith("SELECT") && !/\bLIMIT\s+(\d+|\?)/i.test(blanked)) {
			return `${stripped} LIMIT ${maxRows}`;
		}

		return stripped;
	}

	query(sql: string, params: SQLQueryBindings[] = [], maxRows: number = 10000): QueryResult {
		const safeSql = this.validateAndPrepare(sql, maxRows);
		const start = performance.now();
		const stmt = this.readonlyDb.prepare(safeSql);
		const rows = stmt.all(...params) as Record<string, unknown>[];
		const time_ms = Math.round((performance.now() - start) * 100) / 100;
		return { rows, count: rows.length, time_ms };
	}

	queryIterator(
		sql: string,
		params: SQLQueryBindings[] = [],
		maxRows: number = 10000,
	): IterableIterator<Record<string, unknown>> {
		const safeSql = this.validateAndPrepare(sql, maxRows);
		const stmt = this.readonlyDb.prepare(safeSql);
		return stmt.iterate(...params) as IterableIterator<Record<string, unknown>>;
	}

	getMaxId(): number {
		const row = this.readonlyDb.prepare("SELECT MAX(id) as max_id FROM logs").get() as {
			max_id: number | null;
		} | null;
		return row?.max_id ?? 0;
	}

	getLogCount(): number {
		const row = this.readonlyDb.prepare("SELECT COUNT(*) as count FROM logs").get() as {
			count: number;
		};
		return row.count;
	}

	getDbSize(): number {
		const row = this.readonlyDb
			.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
			.get() as { size: number };
		return row.size;
	}

	getLogsSince(lastId: number, filters: StreamFilters = {}, limit: number = 100): LogEntry[] {
		const conditions = ["id > ?"];
		const params: SQLQueryBindings[] = [lastId];

		if (filters.level) {
			conditions.push("level = ?");
			params.push(filters.level);
		}
		if (filters.service) {
			conditions.push("service = ?");
			params.push(filters.service);
		}
		if (filters.trace_id) {
			conditions.push("trace_id = ?");
			params.push(filters.trace_id);
		}
		if (filters.project) {
			conditions.push("project = ?");
			params.push(filters.project);
		}
		if (filters.branch) {
			conditions.push("branch = ?");
			params.push(filters.branch);
		}

		params.push(limit);
		const sql = `SELECT * FROM logs WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT ?`;
		const rows = this.readonlyDb.prepare(sql).all(...params) as LogEntry[];
		return rows.map((row) => ({ ...row, meta: parseMeta(row.meta) }));
	}

	searchLogs(opts: SearchOptions): { rows: LogEntry[]; total: number } {
		const conditions: string[] = [];
		const params: SQLQueryBindings[] = [];

		if (opts.level) {
			conditions.push("level = ?");
			params.push(opts.level);
		}
		if (opts.service) {
			conditions.push("service = ?");
			params.push(opts.service);
		}
		if (opts.project) {
			conditions.push("project = ?");
			params.push(opts.project);
		}
		if (opts.branch) {
			conditions.push("branch = ?");
			params.push(opts.branch);
		}
		if (opts.grep) {
			conditions.push("message LIKE ? ESCAPE '\\'");
			params.push(`%${escapeLike(opts.grep)}%`);
		}
		if (opts.from) {
			conditions.push("created_at >= ?");
			params.push(opts.from);
		}
		if (opts.to) {
			conditions.push("created_at <= ?");
			params.push(opts.to);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const limit = opts.limit ?? 100;
		const offset = opts.offset ?? 0;

		let total = -1;
		if (opts.includeTotal !== false) {
			const countRow = this.readonlyDb
				.prepare(`SELECT COUNT(*) as total FROM logs ${where}`)
				.get(...params) as { total: number };
			total = countRow.total;
		}

		const queryParams = [...params, limit, offset];
		const rows = this.readonlyDb
			.prepare(`SELECT * FROM logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
			.all(...queryParams) as LogEntry[];

		return {
			rows: rows.map((row) => ({ ...row, meta: parseMeta(row.meta) })),
			total,
		};
	}

	stats(): {
		log_count: number;
		db_size_bytes: number;
		levels: Record<string, number>;
		services: Record<string, number>;
		projects: Record<string, number>;
	} {
		const levelRows = this.readonlyDb
			.prepare("SELECT level, COUNT(*) as count FROM logs GROUP BY level")
			.all() as { level: string; count: number }[];
		const serviceRows = this.readonlyDb
			.prepare(
				"SELECT service, COUNT(*) as count FROM logs WHERE service IS NOT NULL GROUP BY service",
			)
			.all() as { service: string; count: number }[];
		const projectRows = this.readonlyDb
			.prepare(
				"SELECT project, COUNT(*) as count FROM logs WHERE project IS NOT NULL GROUP BY project",
			)
			.all() as { project: string; count: number }[];

		const levels: Record<string, number> = {};
		let totalCount = 0;
		for (const row of levelRows) {
			levels[row.level] = row.count;
			totalCount += row.count;
		}
		const services: Record<string, number> = {};
		for (const row of serviceRows) services[row.service] = row.count;
		const projects: Record<string, number> = {};
		for (const row of projectRows) projects[row.project] = row.count;

		return {
			log_count: totalCount,
			db_size_bytes: this.getDbSize(),
			levels,
			services,
			projects,
		};
	}

	prune(before: number, maxIterations: number = 100): number {
		let totalDeleted = 0;
		const batchSize = 10000;
		const stmt = this.db.prepare(
			`DELETE FROM logs WHERE rowid IN (SELECT rowid FROM logs WHERE created_at < ? LIMIT ${batchSize})`,
		);

		for (let i = 0; i < maxIterations; i++) {
			const result = stmt.run(before);
			totalDeleted += result.changes;
			if (result.changes < batchSize) break;
		}

		if (totalDeleted > 0) {
			this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		}

		return totalDeleted;
	}

	close(): void {
		this.readonlyDb.close();
		this.db.close();
	}
}
