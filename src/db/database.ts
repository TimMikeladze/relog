import { Database, type SQLQueryBindings } from "bun:sqlite";
import { CREATE_INDEXES, CREATE_LOGS_TABLE, CREATE_SOURCE_CURSORS_TABLE } from "./schema.ts";
import type { IngestPayload, LogEntry, StreamFilters } from "../types.ts";
import { parseMeta } from "./util.ts";
import { getDefaultDbPath } from "../paths.ts";
import {
	addColumnIfMissing as addColIfMissing,
	type Migration,
	runMigrations,
} from "./migrations.ts";

export { QueryValidationError } from "./validate.ts";

/**
 * Schema migrations. Append-only — never edit a published migration.
 * Migration 1 retroactively records the ad-hoc ALTERs that pre-existed
 * the migration runner so existing databases get marked as up-to-date
 * without re-running anything destructive.
 */
const MIGRATIONS: Migration[] = [
	{
		id: 1,
		name: "baseline columns (project, branch, version, deployment_id, key_prefix, parent_span_id, duration_ms)",
		up: (db) => {
			addColIfMissing(db, "ALTER TABLE logs ADD COLUMN project TEXT");
			addColIfMissing(db, "ALTER TABLE logs ADD COLUMN branch TEXT");
			addColIfMissing(db, "ALTER TABLE logs ADD COLUMN version TEXT");
			addColIfMissing(db, "ALTER TABLE logs ADD COLUMN deployment_id TEXT");
			addColIfMissing(db, "ALTER TABLE logs ADD COLUMN key_prefix TEXT");
			addColIfMissing(db, "ALTER TABLE logs ADD COLUMN parent_span_id TEXT");
			addColIfMissing(db, "ALTER TABLE logs ADD COLUMN duration_ms REAL");
		},
	},
];

export interface SearchOptions {
	level?: string;
	service?: string;
	project?: string;
	branch?: string;
	version?: string;
	deployment_id?: string;
	trace_id?: string;
	span_id?: string;
	grep?: string;
	from?: number;
	to?: number;
	limit?: number;
	offset?: number;
	includeTotal?: boolean;
	around_id?: number; // center results around this log ID
}

const UPSERT_CURSOR_SQL =
	"INSERT INTO source_cursors (source_id, cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at";

export class RelogDatabase {
	private db: Database;
	private readonlyDb: Database;

	constructor(path: string = getDefaultDbPath()) {
		this.db = new Database(path, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec(CREATE_LOGS_TABLE);
		this.db.exec(CREATE_SOURCE_CURSORS_TABLE);
		runMigrations(this.db, MIGRATIONS);
		for (const idx of CREATE_INDEXES) {
			this.db.exec(idx);
		}

		this.readonlyDb = new Database(path, {
			readonly: true,
			create: false,
		});
		this.readonlyDb.exec("PRAGMA busy_timeout = 5000");
	}

	insert(entries: IngestPayload[], keyPrefix?: string): void {
		const stmt = this.db.prepare(`
      INSERT INTO logs (timestamp, level, message, meta, service, host, pid, trace_id, span_id, parent_span_id, project, branch, version, deployment_id, duration_ms, key_prefix, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
				// Extract duration_ms from meta as fallback (EventBuilder puts it there)
				let durationMs: number | null = entry.duration_ms ?? null;
				if (durationMs === null && entry.meta) {
					const metaDuration = entry.meta.duration_ms;
					if (typeof metaDuration === "number") {
						durationMs = metaDuration;
					}
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
					entry.parent_span_id ?? null,
					entry.project ?? null,
					entry.branch ?? null,
					entry.version ?? null,
					entry.deployment_id ?? null,
					durationMs,
					keyPrefix ?? null,
					createdAt,
				);
			}
		})();
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
			.prepare(
				"SELECT (page_count - freelist_count) * page_size as size FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()",
			)
			.get() as { size: number };
		return row.size;
	}

	getOldestLogs(limit: number): LogEntry[] {
		const rows = this.readonlyDb
			.prepare("SELECT * FROM logs ORDER BY created_at ASC LIMIT ?")
			.all(limit) as LogEntry[];
		return rows.map((row) => ({ ...row, meta: parseMeta(row.meta) }));
	}

	walCheckpoint(): void {
		this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	}

	getLogsSince(lastId: number, filters: StreamFilters = {}, limit: number = 100): LogEntry[] {
		const conditions = ["id > ?"];
		const params: SQLQueryBindings[] = [lastId];

		for (const col of [
			"level",
			"service",
			"trace_id",
			"project",
			"branch",
			"version",
			"deployment_id",
		] as const) {
			const val = filters[col];
			if (!val) continue;
			const values = String(val).split(",").filter(Boolean);
			if (values.length === 1) {
				conditions.push(`${col} = ?`);
				params.push(values[0]!);
			} else if (values.length > 1) {
				conditions.push(`${col} IN (${values.map(() => "?").join(", ")})`);
				params.push(...values);
			}
		}
		params.push(limit);
		const sql = `SELECT * FROM logs WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT ?`;
		const rows = this.readonlyDb.prepare(sql).all(...params) as LogEntry[];
		return rows.map((row) => ({ ...row, meta: parseMeta(row.meta) }));
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

	pruneOldest(count: number): number {
		const stmt = this.db.prepare(
			`DELETE FROM logs WHERE rowid IN (SELECT rowid FROM logs ORDER BY created_at ASC LIMIT ?)`,
		);
		const result = stmt.run(count);
		if (result.changes > 0) {
			this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		}
		return result.changes;
	}

	getLogsForArchive(before: number, batchSize: number = 10000): LogEntry[] {
		const rows = this.readonlyDb
			.prepare("SELECT * FROM logs WHERE created_at < ? ORDER BY created_at ASC LIMIT ?")
			.all(before, batchSize) as LogEntry[];
		return rows.map((row) => ({ ...row, meta: parseMeta(row.meta) }));
	}

	deleteByIds(ids: number[]): number {
		if (ids.length === 0) return 0;
		const chunkSize = 500;
		let totalChanges = 0;

		this.db.transaction(() => {
			for (let i = 0; i < ids.length; i += chunkSize) {
				const chunk = ids.slice(i, i + chunkSize);
				const placeholders = chunk.map(() => "?").join(",");
				const result = this.db
					.prepare(`DELETE FROM logs WHERE id IN (${placeholders})`)
					.run(...chunk);
				totalChanges += result.changes;
			}
		})();

		if (totalChanges > 0) {
			this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		}

		return totalChanges;
	}

	getCursor(sourceId: string): string | null {
		const row = this.readonlyDb
			.prepare("SELECT cursor FROM source_cursors WHERE source_id = ?")
			.get(sourceId) as { cursor: string } | null;
		return row?.cursor ?? null;
	}

	setCursor(sourceId: string, cursor: string): void {
		this.db.prepare(UPSERT_CURSOR_SQL).run(sourceId, cursor, Date.now());
	}

	insertAndSetCursor(
		entries: IngestPayload[],
		sourceId: string,
		cursor: string,
		keyPrefix?: string,
	): void {
		const insertStmt = this.db.prepare(`
      INSERT INTO logs (timestamp, level, message, meta, service, host, pid, trace_id, span_id, parent_span_id, project, branch, version, deployment_id, duration_ms, key_prefix, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
		const cursorStmt = this.db.prepare(UPSERT_CURSOR_SQL);

		const now = Date.now();
		this.db.transaction(() => {
			for (const entry of entries) {
				let ts: string;
				let createdAt: number;

				if (entry.timestamp) {
					const parsed = new Date(entry.timestamp).getTime();
					if (Number.isNaN(parsed)) {
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

				let durationMs: number | null = entry.duration_ms ?? null;
				if (durationMs === null && entry.meta) {
					const metaDuration = entry.meta.duration_ms;
					if (typeof metaDuration === "number") {
						durationMs = metaDuration;
					}
				}

				insertStmt.run(
					ts,
					entry.level,
					entry.message,
					entry.meta ? JSON.stringify(entry.meta) : null,
					entry.service ?? null,
					entry.host ?? null,
					entry.pid ?? null,
					entry.trace_id ?? null,
					entry.span_id ?? null,
					entry.parent_span_id ?? null,
					entry.project ?? null,
					entry.branch ?? null,
					entry.version ?? null,
					entry.deployment_id ?? null,
					durationMs,
					keyPrefix ?? null,
					createdAt,
				);
			}
			cursorStmt.run(sourceId, cursor, now);
		})();
	}

	close(): void {
		this.readonlyDb.close();
		this.db.close();
	}
}
