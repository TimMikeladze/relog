import { Database, type SQLQueryBindings } from "bun:sqlite";
import { CREATE_INDEXES, CREATE_LOGS_TABLE } from "./schema.ts";
import type { IngestPayload, LogEntry, StreamFilters } from "../types.ts";
import { parseMeta } from "./util.ts";
import { getDefaultDbPath } from "../paths.ts";

export { QueryValidationError } from "./validate.ts";

export interface SearchOptions {
	level?: string;
	service?: string;
	project?: string;
	branch?: string;
	version?: string;
	deployment_id?: string;
	grep?: string;
	from?: number;
	to?: number;
	limit?: number;
	offset?: number;
	includeTotal?: boolean;
	around_id?: number; // center results around this log ID
}

export class RelogDatabase {
	private db: Database;
	private readonlyDb: Database;

	constructor(path: string = getDefaultDbPath()) {
		this.db = new Database(path, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec(CREATE_LOGS_TABLE);
		// Migrate: add columns for existing DBs
		try {
			this.db.exec("ALTER TABLE logs ADD COLUMN project TEXT");
		} catch {}
		try {
			this.db.exec("ALTER TABLE logs ADD COLUMN branch TEXT");
		} catch {}
		try {
			this.db.exec("ALTER TABLE logs ADD COLUMN version TEXT");
		} catch {}
		try {
			this.db.exec("ALTER TABLE logs ADD COLUMN deployment_id TEXT");
		} catch {}
		try {
			this.db.exec("ALTER TABLE logs ADD COLUMN key_prefix TEXT");
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

	insert(entries: IngestPayload[], keyPrefix?: string): void {
		const stmt = this.db.prepare(`
      INSERT INTO logs (timestamp, level, message, meta, service, host, pid, trace_id, span_id, project, branch, version, deployment_id, key_prefix, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
					entry.version ?? null,
					entry.deployment_id ?? null,
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
			.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
			.get() as { size: number };
		return row.size;
	}

	getLogsSince(lastId: number, filters: StreamFilters = {}, limit: number = 100): LogEntry[] {
		const conditions = ["id > ?"];
		const params: SQLQueryBindings[] = [lastId];

		for (const col of ["level", "service", "trace_id", "project", "branch", "version", "deployment_id"] as const) {
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

	close(): void {
		this.readonlyDb.close();
		this.db.close();
	}
}
