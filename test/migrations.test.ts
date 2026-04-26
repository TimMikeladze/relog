import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations, addColumnIfMissing, type Migration } from "../src/db/migrations.ts";

function memDb(): Database {
	return new Database(":memory:");
}

describe("runMigrations", () => {
	test("applies pending migrations in id order", () => {
		const db = memDb();
		db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
		const order: number[] = [];
		const migs: Migration[] = [
			{ id: 2, name: "second", up: () => order.push(2) },
			{ id: 1, name: "first", up: () => order.push(1) },
			{ id: 3, name: "third", up: () => order.push(3) },
		];
		const result = runMigrations(db, migs);
		expect(order).toEqual([1, 2, 3]);
		expect(result.applied).toEqual([1, 2, 3]);
	});

	test("skips already-applied migrations on second run", () => {
		const db = memDb();
		const calls = { count: 0 };
		const migs: Migration[] = [{ id: 1, name: "x", up: () => calls.count++ }];
		runMigrations(db, migs);
		runMigrations(db, migs);
		expect(calls.count).toBe(1);
	});

	test("rolls back schema_migrations row when migration body throws", () => {
		const db = memDb();
		const migs: Migration[] = [
			{
				id: 1,
				name: "broken",
				up: () => {
					throw new Error("nope");
				},
			},
		];
		expect(() => runMigrations(db, migs)).toThrow(/broken.*nope/);
		const rows = db.prepare("SELECT id FROM schema_migrations").all();
		expect(rows.length).toBe(0);
	});

	test("rejects duplicate migration ids", () => {
		const db = memDb();
		const migs: Migration[] = [
			{ id: 1, name: "a", up: () => {} },
			{ id: 1, name: "b", up: () => {} },
		];
		expect(() => runMigrations(db, migs)).toThrow(/Duplicate migration id 1/);
	});

	test("creates schema_migrations table on first run", () => {
		const db = memDb();
		runMigrations(db, []);
		const rows = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
			.all();
		expect(rows.length).toBe(1);
	});
});

describe("addColumnIfMissing", () => {
	test("adds new column", () => {
		const db = memDb();
		db.exec("CREATE TABLE t (id INTEGER)");
		addColumnIfMissing(db, "ALTER TABLE t ADD COLUMN x TEXT");
		const cols = db.prepare("PRAGMA table_info(t)").all() as { name: string }[];
		expect(cols.find((c) => c.name === "x")).toBeDefined();
	});

	test("swallows duplicate column error", () => {
		const db = memDb();
		db.exec("CREATE TABLE t (id INTEGER, x TEXT)");
		expect(() => addColumnIfMissing(db, "ALTER TABLE t ADD COLUMN x TEXT")).not.toThrow();
	});

	test("propagates non-duplicate errors", () => {
		const db = memDb();
		expect(() => addColumnIfMissing(db, "ALTER TABLE no_such_table ADD COLUMN x TEXT")).toThrow();
	});
});
