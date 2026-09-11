import type { Database } from "bun:sqlite";

/**
 * Idempotent SQLite migration runner.
 *
 * Why this and not Drizzle/Knex/Umzug: relog is a single-process embedded
 * SQLite store; it does not need a heavyweight ORM toolkit, and we want
 * the migration code to be inspectable in one short file. We track the
 * applied migrations by id in a `schema_migrations` table (so we can add
 * out-of-order migrations safely) and run any new ones inside a single
 * transaction per migration so a partial failure leaves the schema
 * version intact and re-runnable.
 */
export interface Migration {
	/** Stable, monotonically-assigned id. Never re-use or rewrite a published id. */
	id: number;
	/** Human-readable label for logs. */
	name: string;
	/** Idempotent migration body. SQLite + Bun expose synchronous APIs. */
	up: (db: Database) => void;
}

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at INTEGER NOT NULL
)`;

function appliedIds(db: Database): Set<number> {
	const rows = db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[];
	return new Set(rows.map((r) => r.id));
}

export function runMigrations(db: Database, migrations: Migration[]): { applied: number[] } {
	db.exec(CREATE_MIGRATIONS_TABLE);

	// Sort by id so out-of-order definitions still apply deterministically.
	const ordered = [...migrations].sort((a, b) => a.id - b.id);

	// Detect duplicate ids early — otherwise the second one silently
	// becomes a no-op (already applied) and the developer is confused
	// when their schema change doesn't take effect.
	const seen = new Set<number>();
	for (const m of ordered) {
		if (seen.has(m.id)) {
			throw new Error(`Duplicate migration id ${m.id} ("${m.name}")`);
		}
		seen.add(m.id);
	}

	const already = appliedIds(db);
	const applied: number[] = [];

	for (const m of ordered) {
		if (already.has(m.id)) continue;
		const tx = db.transaction(() => {
			m.up(db);
			db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
				m.id,
				m.name,
				Date.now(),
			);
		});
		try {
			tx();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`Migration ${m.id} ("${m.name}") failed: ${msg}`);
		}
		applied.push(m.id);
		console.log(`[relog.sh] Applied migration ${m.id}: ${m.name}`);
	}

	return { applied };
}

/**
 * Wraps an `ALTER TABLE ... ADD COLUMN` so that re-running a migration
 * doesn't blow up on existing schemas that were already migrated by the
 * pre-runner ad-hoc code. Only swallows the specific "duplicate column
 * name" error; any other failure still propagates.
 */
export function addColumnIfMissing(db: Database, sql: string): void {
	try {
		db.exec(sql);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) throw err;
	}
}
