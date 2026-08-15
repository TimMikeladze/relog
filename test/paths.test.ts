import { homedir, tmpdir } from "node:os";
import { join, isAbsolute, dirname } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import {
	getAppDistPath,
	getDataDir,
	getDefaultDbPath,
	getWidgetsPath,
	resolveAppDist,
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

describe("resolveAppDist", () => {
	const roots: string[] = [];

	function makeRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "relog-paths-"));
		roots.push(root);
		return root;
	}

	function writeUi(dir: string, html = "<script src=/assets/index.js></script>"): void {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "index.html"), html);
	}

	/** A checkout of app/: Vite's dev entry, its config, and the built output. */
	function writeViteSource(dir: string, { built }: { built: boolean }): void {
		writeUi(dir, '<script type="module" src="/src/main.tsx"></script>');
		writeFileSync(join(dir, "vite.config.ts"), "export default {}\n");
		if (built) writeUi(join(dir, "dist"));
	}

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	test("finds the UI copied next to the compiled cli", () => {
		const root = makeRoot();
		const dist = join(root, "dist");
		writeUi(join(dist, "app"));
		expect(resolveAppDist(dist)).toBe(join(dist, "app"));
	});

	test("finds the UI one level up when bunup nests shared modules", () => {
		const root = makeRoot();
		writeUi(join(root, "dist/app"));
		expect(resolveAppDist(join(root, "dist/shared"))).toBe(join(root, "dist/shared", "../app"));
	});

	test("serves app/dist, not the Vite source dir, in a source checkout", () => {
		const root = makeRoot();
		writeViteSource(join(root, "app"), { built: true });
		expect(resolveAppDist(join(root, "src"))).toBe(join(root, "src", "../app/dist"));
	});

	test("returns null when a source checkout has no build output", () => {
		const root = makeRoot();
		writeViteSource(join(root, "app"), { built: false });
		expect(resolveAppDist(join(root, "src"))).toBeNull();
	});

	test("returns null when no candidate has an index.html", () => {
		const root = makeRoot();
		mkdirSync(join(root, "src"), { recursive: true });
		expect(resolveAppDist(join(root, "src"))).toBeNull();
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
