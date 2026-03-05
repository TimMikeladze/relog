import { homedir } from "node:os";
import { join, isAbsolute, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { getDataDir, getDefaultDbPath } from "../src/paths.ts";

describe("getDataDir", () => {
	test("returns path inside home directory", () => {
		const dir = getDataDir();
		expect(dir).toBe(join(homedir(), ".relog"));
	});

	test("returns an absolute path", () => {
		const dir = getDataDir();
		expect(isAbsolute(dir)).toBe(true);
	});

	test("creates the directory if it does not exist", () => {
		const dir = getDataDir();
		expect(existsSync(dir)).toBe(true);
		expect(statSync(dir).isDirectory()).toBe(true);
	});

	test("is idempotent - calling multiple times does not error", () => {
		expect(() => {
			getDataDir();
			getDataDir();
			getDataDir();
		}).not.toThrow();
	});
});

describe("getDefaultDbPath", () => {
	test("returns relog.db inside data directory", () => {
		const dbPath = getDefaultDbPath();
		expect(dbPath).toBe(join(homedir(), ".relog", "relog.db"));
	});

	test("returns an absolute path", () => {
		const dbPath = getDefaultDbPath();
		expect(isAbsolute(dbPath)).toBe(true);
	});

	test("parent directory exists after calling", () => {
		const dbPath = getDefaultDbPath();
		const dir = dirname(dbPath);
		expect(existsSync(dir)).toBe(true);
	});

	test("filename is relog.db", () => {
		const dbPath = getDefaultDbPath();
		expect(dbPath.endsWith("relog.db")).toBe(true);
	});
});
