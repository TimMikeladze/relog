import { homedir } from "node:os";
import { join, isAbsolute, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import {
	getAppDistPath,
	getDataDir,
	getDefaultDbPath,
	getWidgetsPath,
	setAppDistResolver,
} from "../src/paths.ts";

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

describe("getAppDistPath", () => {
	afterEach(() => setAppDistResolver(null));

	test("prefers a registered resolver over disk lookup", () => {
		setAppDistResolver(() => "/unpacked/ui");
		expect(getAppDistPath()).toBe("/unpacked/ui");
	});

	test("only calls the resolver when the path is requested", () => {
		let calls = 0;
		setAppDistResolver(() => {
			calls++;
			return "/unpacked/ui";
		});
		expect(calls).toBe(0);
		getAppDistPath();
		expect(calls).toBe(1);
	});

	test("falls back to disk lookup once the resolver is cleared", () => {
		setAppDistResolver(() => "/unpacked/ui");
		setAppDistResolver(null);
		expect(getAppDistPath()).not.toBe("/unpacked/ui");
	});
});

describe("getWidgetsPath", () => {
	test("returns widgets.json inside data directory", () => {
		const p = getWidgetsPath();
		expect(p).toBe(join(homedir(), ".relog", "widgets.json"));
	});

	test("returns an absolute path", () => {
		const p = getWidgetsPath();
		expect(isAbsolute(p)).toBe(true);
	});
});
