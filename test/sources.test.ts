import { describe, expect, test } from "bun:test";
import { loadSourcesConfig, deriveSourceId } from "../src/sources/config.ts";
import { getAdapter } from "../src/sources/registry.ts";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("sources config parser", () => {
	test("parses valid YAML config", () => {
		const path = join(tmpdir(), `relog-test-sources-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - adapter: github-actions
    repo: myorg/app
    token: test-token-123
    every: 60
  - adapter: github-actions
    repo: myorg/api
    token: test-token-456
    every: 120
`,
		);

		const configs = loadSourcesConfig(path);
		expect(configs).toHaveLength(2);
		expect(configs[0]!.adapter).toBe("github-actions");
		expect(configs[0]!.repo).toBe("myorg/app");
		expect(configs[0]!.token).toBe("test-token-123");
		expect(configs[0]!.every).toBe(60);
		expect(configs[1]!.repo).toBe("myorg/api");
		expect(configs[1]!.every).toBe(120);

		unlinkSync(path);
	});

	test("resolves env vars", () => {
		process.env.TEST_RELOG_TOKEN = "ghp_secret123";
		const path = join(tmpdir(), `relog-test-sources-env-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - adapter: github-actions
    repo: myorg/app
    token: $TEST_RELOG_TOKEN
    every: 60
`,
		);

		const configs = loadSourcesConfig(path);
		expect(configs[0]!.token).toBe("ghp_secret123");

		unlinkSync(path);
		delete process.env.TEST_RELOG_TOKEN;
	});

	test("throws on missing env var", () => {
		const path = join(tmpdir(), `relog-test-sources-missing-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - adapter: github-actions
    repo: myorg/app
    token: $NONEXISTENT_VAR_12345
    every: 60
`,
		);

		expect(() => loadSourcesConfig(path)).toThrow("NONEXISTENT_VAR_12345");
		unlinkSync(path);
	});

	test("throws on missing adapter", () => {
		const path = join(tmpdir(), `relog-test-sources-noadapt-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - repo: myorg/app
    every: 60
`,
		);

		expect(() => loadSourcesConfig(path)).toThrow("adapter");
		unlinkSync(path);
	});

	test("handles hyphenated keys", () => {
		const path = join(tmpdir(), `relog-test-sources-hyphen-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - adapter: github-actions
    repo: myorg/app
    api-base: https://github.example.com
    token: test-123
    every: 60
`,
		);

		const configs = loadSourcesConfig(path);
		expect(configs[0]!["api-base"]).toBe("https://github.example.com");

		unlinkSync(path);
	});

	test("handles # in quoted values", () => {
		const path = join(tmpdir(), `relog-test-sources-hash-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - adapter: github-actions
    repo: myorg/app
    branch: "feature/#123"
    token: test-123
    every: 60
`,
		);

		const configs = loadSourcesConfig(path);
		expect(configs[0]!.branch).toBe("feature/#123");

		unlinkSync(path);
	});

	test("clamps minimum every to 10s", () => {
		const path = join(tmpdir(), `relog-test-sources-min-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - adapter: github-actions
    repo: myorg/app
    token: test-123
    every: 1
`,
		);

		const configs = loadSourcesConfig(path);
		expect(configs[0]!.every).toBe(10);

		unlinkSync(path);
	});

	test("throws on duplicate source IDs", () => {
		const path = join(tmpdir(), `relog-test-sources-dup-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:
  - adapter: github-actions
    repo: myorg/app
    token: test-111
    every: 60
  - adapter: github-actions
    repo: myorg/app
    token: test-222
    every: 120
`,
		);

		expect(() => loadSourcesConfig(path)).toThrow("Duplicate source id");
		unlinkSync(path);
	});
});

describe("source ID derivation", () => {
	test("uses explicit id when set", () => {
		const id = deriveSourceId({ adapter: "github-actions", every: 60, id: "my-source", repo: "myorg/app", token: "x" });
		expect(id).toBe("my-source");
	});

	test("derives stable id from non-secret config keys", () => {
		const id = deriveSourceId({ adapter: "github-actions", every: 60, repo: "myorg/app", token: "ghp_xxx", branch: "main" });
		expect(id).toBe("github-actions:branch=main,repo=myorg/app");
		expect(id).not.toContain("token");
		expect(id).not.toContain("ghp_xxx");
	});

	test("id is stable regardless of key order", () => {
		const id1 = deriveSourceId({ adapter: "github-actions", every: 60, repo: "myorg/app", branch: "main", token: "x" });
		const id2 = deriveSourceId({ adapter: "github-actions", branch: "main", every: 60, token: "x", repo: "myorg/app" });
		expect(id1).toBe(id2);
	});

	test("falls back to adapter name when no non-secret keys", () => {
		const id = deriveSourceId({ adapter: "custom", every: 60, token: "secret" });
		expect(id).toBe("custom");
	});
});

describe("adapter registry", () => {
	test("finds github-actions adapter", () => {
		const adapter = getAdapter("github-actions");
		expect(adapter.name).toBe("github-actions");
	});

	test("throws on unknown adapter", () => {
		expect(() => getAdapter("nonexistent")).toThrow("Unknown source adapter");
	});
});

describe("cursor persistence", () => {
	test("get/set cursor round-trips", async () => {
		const { RelogDatabase } = await import("../src/db/database.ts");
		const path = join(tmpdir(), `relog-test-cursors-${Date.now()}.db`);
		const db = new RelogDatabase(path);

		expect(db.getCursor("test-source")).toBeNull();

		db.setCursor("test-source", "2026-03-12T00:00:00Z|12345,12346");
		expect(db.getCursor("test-source")).toBe("2026-03-12T00:00:00Z|12345,12346");

		db.setCursor("test-source", "2026-03-13T00:00:00Z|67890");
		expect(db.getCursor("test-source")).toBe("2026-03-13T00:00:00Z|67890");

		db.close();
		unlinkSync(path);
		try { unlinkSync(`${path}-wal`); } catch {}
		try { unlinkSync(`${path}-shm`); } catch {}
	});

	test("separate cursors per source", async () => {
		const { RelogDatabase } = await import("../src/db/database.ts");
		const path = join(tmpdir(), `relog-test-cursors-multi-${Date.now()}.db`);
		const db = new RelogDatabase(path);

		db.setCursor("github-actions:repo=myorg/app", "2026-03-12T00:00:00Z|100");
		db.setCursor("github-actions:repo=myorg/api", "2026-03-11T00:00:00Z|200");

		expect(db.getCursor("github-actions:repo=myorg/app")).toBe("2026-03-12T00:00:00Z|100");
		expect(db.getCursor("github-actions:repo=myorg/api")).toBe("2026-03-11T00:00:00Z|200");

		db.close();
		unlinkSync(path);
		try { unlinkSync(`${path}-wal`); } catch {}
		try { unlinkSync(`${path}-shm`); } catch {}
	});

	test("insertAndSetCursor is atomic", async () => {
		const { RelogDatabase } = await import("../src/db/database.ts");
		const path = join(tmpdir(), `relog-test-atomic-${Date.now()}.db`);
		const db = new RelogDatabase(path);

		db.insertAndSetCursor(
			[{ level: "info", message: "test log from source" }],
			"test-source",
			"2026-03-13T00:00:00Z|999",
		);

		expect(db.getCursor("test-source")).toBe("2026-03-13T00:00:00Z|999");
		expect(db.getLogCount()).toBe(1);

		db.close();
		unlinkSync(path);
		try { unlinkSync(`${path}-wal`); } catch {}
		try { unlinkSync(`${path}-shm`); } catch {}
	});
});
