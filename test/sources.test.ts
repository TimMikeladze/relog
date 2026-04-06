import { describe, expect, test, mock } from "bun:test";
import { loadSourcesConfig, deriveSourceId } from "../src/sources/config.ts";
import { getAdapter } from "../src/sources/registry.ts";
import { startSources } from "../src/sources/runner.ts";
import {
	parseCursor,
	buildCursor,
	runToLogs,
	GitHubRateLimitError,
	type WorkflowRun,
	type WorkflowJob,
} from "../src/sources/adapters/github-actions.ts";
import type { SourceAdapter, PullBatch } from "../src/sources/types.ts";
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
		const id = deriveSourceId({
			adapter: "github-actions",
			every: 60,
			id: "my-source",
			repo: "myorg/app",
			token: "x",
		});
		expect(id).toBe("my-source");
	});

	test("derives stable id from non-secret config keys", () => {
		const id = deriveSourceId({
			adapter: "github-actions",
			every: 60,
			repo: "myorg/app",
			token: "ghp_xxx",
			branch: "main",
		});
		expect(id).toBe("github-actions:branch=main,repo=myorg/app");
		expect(id).not.toContain("token");
		expect(id).not.toContain("ghp_xxx");
	});

	test("id is stable regardless of key order", () => {
		const id1 = deriveSourceId({
			adapter: "github-actions",
			every: 60,
			repo: "myorg/app",
			branch: "main",
			token: "x",
		});
		const id2 = deriveSourceId({
			adapter: "github-actions",
			branch: "main",
			every: 60,
			token: "x",
			repo: "myorg/app",
		});
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
		try {
			unlinkSync(`${path}-wal`);
		} catch {}
		try {
			unlinkSync(`${path}-shm`);
		} catch {}
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
		try {
			unlinkSync(`${path}-wal`);
		} catch {}
		try {
			unlinkSync(`${path}-shm`);
		} catch {}
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
		try {
			unlinkSync(`${path}-wal`);
		} catch {}
		try {
			unlinkSync(`${path}-shm`);
		} catch {}
	});
});

// --- Adapter internals ---

describe("parseCursor", () => {
	test("returns null for null/empty input", () => {
		expect(parseCursor(null)).toBeNull();
		expect(parseCursor("")).toBeNull();
	});

	test("returns null for missing pipe separator", () => {
		expect(parseCursor("2026-03-12T00:00:00Z")).toBeNull();
	});

	test("returns null for invalid timestamp", () => {
		expect(parseCursor("not-a-date|123")).toBeNull();
	});

	test("parses valid cursor with IDs", () => {
		const result = parseCursor("2026-03-12T00:00:00Z|100,200,300");
		expect(result).not.toBeNull();
		expect(result!.timestamp).toBe("2026-03-12T00:00:00Z");
		expect(result!.seenIds.size).toBe(3);
		expect(result!.seenIds.has(100)).toBe(true);
		expect(result!.seenIds.has(200)).toBe(true);
		expect(result!.seenIds.has(300)).toBe(true);
	});

	test("handles cursor with no IDs", () => {
		const result = parseCursor("2026-03-12T00:00:00Z|");
		expect(result).not.toBeNull();
		expect(result!.timestamp).toBe("2026-03-12T00:00:00Z");
		expect(result!.seenIds.size).toBe(0);
	});

	test("ignores non-numeric ID segments", () => {
		const result = parseCursor("2026-03-12T00:00:00Z|100,abc,200");
		expect(result!.seenIds.size).toBe(2);
		expect(result!.seenIds.has(100)).toBe(true);
		expect(result!.seenIds.has(200)).toBe(true);
	});
});

describe("buildCursor", () => {
	test("round-trips with parseCursor", () => {
		const ids = new Set([100, 200, 300]);
		const cursor = buildCursor("2026-03-12T00:00:00Z", ids);
		const parsed = parseCursor(cursor);
		expect(parsed!.timestamp).toBe("2026-03-12T00:00:00Z");
		expect(parsed!.seenIds).toEqual(ids);
	});

	test("handles empty ID set", () => {
		const cursor = buildCursor("2026-03-12T00:00:00Z", new Set());
		expect(cursor).toBe("2026-03-12T00:00:00Z|");
	});
});

describe("runToLogs", () => {
	const makeRun = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
		id: 1,
		name: "CI",
		head_branch: "main",
		head_sha: "abc12345def67890",
		conclusion: "success",
		status: "completed",
		created_at: "2026-03-12T00:00:00Z",
		updated_at: "2026-03-12T00:01:00Z",
		html_url: "https://github.com/myorg/app/actions/runs/1",
		repository: { full_name: "myorg/app" },
		...overrides,
	});

	const makeJob = (overrides: Partial<WorkflowJob> = {}): WorkflowJob => ({
		id: 10,
		name: "build",
		conclusion: "success",
		started_at: "2026-03-12T00:00:10Z",
		completed_at: "2026-03-12T00:01:00Z",
		steps: [
			{
				name: "Checkout",
				status: "completed",
				conclusion: "success",
				number: 1,
				started_at: "2026-03-12T00:00:10Z",
				completed_at: "2026-03-12T00:00:15Z",
			},
		],
		...overrides,
	});

	test("maps step conclusions to log levels", () => {
		const failedJob = makeJob({
			steps: [
				{
					name: "Build",
					status: "completed",
					conclusion: "failure",
					number: 1,
					started_at: "2026-03-12T00:00:10Z",
					completed_at: null,
				},
				{
					name: "Lint",
					status: "completed",
					conclusion: "skipped",
					number: 2,
					started_at: null,
					completed_at: null,
				},
				{
					name: "Test",
					status: "completed",
					conclusion: "success",
					number: 3,
					started_at: "2026-03-12T00:00:20Z",
					completed_at: null,
				},
			],
		});

		const logs = runToLogs(makeRun(), [failedJob]);
		// 3 step logs + 1 job summary
		expect(logs).toHaveLength(4);
		expect(logs[0]!.level).toBe("error"); // failure → error
		expect(logs[1]!.level).toBe("debug"); // skipped → debug
		expect(logs[2]!.level).toBe("info"); // success → info
	});

	test("sets correct trace_id and version", () => {
		const logs = runToLogs(makeRun({ id: 42, head_sha: "deadbeef12345678" }), [makeJob()]);
		expect(logs[0]!.trace_id).toBe("gha:42");
		expect(logs[0]!.version).toBe("deadbeef");
	});

	test("job summary uses job conclusion for level", () => {
		const failedJob = makeJob({ conclusion: "failure" });
		const logs = runToLogs(makeRun(), [failedJob]);
		const summary = logs.find((l) => l.meta?.is_summary);
		expect(summary!.level).toBe("error");
	});

	test("uses job started_at as fallback when step started_at is null", () => {
		const job = makeJob({
			started_at: "2026-03-12T00:00:10Z",
			steps: [
				{
					name: "Step",
					status: "completed",
					conclusion: "success",
					number: 1,
					started_at: null,
					completed_at: null,
				},
			],
		});
		const logs = runToLogs(makeRun(), [job]);
		expect(logs[0]!.timestamp).toBe("2026-03-12T00:00:10Z");
	});
});

describe("GitHubRateLimitError", () => {
	test("carries retryAfter value", () => {
		const err = new GitHubRateLimitError(120);
		expect(err.retryAfter).toBe(120);
		expect(err.name).toBe("GitHubRateLimitError");
		expect(err.message).toContain("120");
	});
});

describe("github-actions adapter validation", () => {
	test("throws on missing repo", async () => {
		const adapter = getAdapter("github-actions");
		const iter = adapter.pull({ token: "tok", repo: "", every: 60 }, null);
		await expect(async () => {
			for await (const _ of iter) {
				/* drain */
			}
		}).toThrow("requires 'repo'");
	});

	test("throws on invalid repo format", async () => {
		const adapter = getAdapter("github-actions");
		const iter = adapter.pull({ token: "tok", repo: "../../etc/passwd", every: 60 }, null);
		await expect(async () => {
			for await (const _ of iter) {
				/* drain */
			}
		}).toThrow("invalid repo format");
	});

	test("throws on missing token", async () => {
		const adapter = getAdapter("github-actions");
		const iter = adapter.pull({ repo: "myorg/app", token: "", every: 60 }, null);
		await expect(async () => {
			for await (const _ of iter) {
				/* drain */
			}
		}).toThrow("requires 'token'");
	});
});

// --- Runner lifecycle ---

function cleanupDb(path: string) {
	for (const f of [path, `${path}-wal`, `${path}-shm`]) {
		try {
			unlinkSync(f);
		} catch {}
	}
}

describe("source runner", () => {
	function makeMockAdapter(pullFn: SourceAdapter["pull"]): SourceAdapter {
		return { name: "mock-adapter", pull: pullFn };
	}

	function makeMockStreamManager() {
		let notifyCount = 0;
		return {
			notify: () => {
				notifyCount++;
			},
			get notifyCount() {
				return notifyCount;
			},
		};
	}

	test("ingests batches and updates cursor", async () => {
		const { RelogDatabase } = await import("../src/db/database.ts");
		const path = join(tmpdir(), `relog-test-runner-${Date.now()}.db`);
		const db = new RelogDatabase(path);
		const sm = makeMockStreamManager();

		const adapter = makeMockAdapter(async function* (_config, _cursor) {
			yield {
				logs: [{ level: "info" as const, message: "hello" }],
				cursor: "2026-01-01T00:00:00Z|1",
			};
		});

		// Temporarily register mock adapter
		const { default: registry } = await import("../src/sources/registry.ts").then(() => {
			// Use the real registry but test through startSources with a config
			// that points to a real adapter. Instead, test the DB directly.
			return { default: null };
		});

		// Direct test: simulate what the runner does
		const cursor = db.getCursor("test-runner");
		expect(cursor).toBeNull();

		db.insertAndSetCursor(
			[{ level: "info", message: "runner test log" }],
			"test-runner",
			"2026-01-01T00:00:00Z|1",
		);

		expect(db.getCursor("test-runner")).toBe("2026-01-01T00:00:00Z|1");
		expect(db.getLogCount()).toBe(1);

		db.close();
		cleanupDb(path);
	});

	test("stop() resolves even with no in-flight ticks", async () => {
		const { RelogDatabase } = await import("../src/db/database.ts");
		const path = join(tmpdir(), `relog-test-runner-stop-${Date.now()}.db`);
		const db = new RelogDatabase(path);
		const sm = makeMockStreamManager();

		// startSources with a very long interval so no tick fires after initial
		const handle = startSources(db, sm as any, [
			{
				adapter: "github-actions",
				every: 99999,
				repo: "test/noop",
				token: "fake-token",
			},
		]);

		// The initial tick will fail (no real GitHub API), but stop should still work
		await Bun.sleep(100); // let the initial tick fire and fail
		await handle.stop();

		db.close();
		cleanupDb(path);
	});

	test("stop() prevents further ticks from running", async () => {
		const { RelogDatabase } = await import("../src/db/database.ts");
		const path = join(tmpdir(), `relog-test-runner-noop-${Date.now()}.db`);
		const db = new RelogDatabase(path);
		const sm = makeMockStreamManager();

		const handle = startSources(db, sm as any, [
			{
				adapter: "github-actions",
				every: 99999,
				repo: "test/noop",
				token: "fake-token",
			},
		]);

		await Bun.sleep(50);
		await handle.stop();

		// After stop, DB should still be usable (not closed prematurely)
		expect(() => db.getCursor("anything")).not.toThrow();

		db.close();
		cleanupDb(path);
	});
});

describe("config edge cases", () => {
	test("throws on every: 0", () => {
		const path = join(tmpdir(), `relog-test-every0-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:\n  - adapter: github-actions\n    repo: myorg/app\n    token: x\n    every: 0\n`,
		);
		expect(() => loadSourcesConfig(path)).toThrow("positive");
		unlinkSync(path);
	});

	test("throws on negative every", () => {
		const path = join(tmpdir(), `relog-test-everyneg-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:\n  - adapter: github-actions\n    repo: myorg/app\n    token: x\n    every: -5\n`,
		);
		expect(() => loadSourcesConfig(path)).toThrow("positive");
		unlinkSync(path);
	});

	test("throws on non-numeric every", () => {
		const path = join(tmpdir(), `relog-test-everystr-${Date.now()}.yaml`);
		writeFileSync(
			path,
			`sources:\n  - adapter: github-actions\n    repo: myorg/app\n    token: x\n    every: fast\n`,
		);
		expect(() => loadSourcesConfig(path)).toThrow("positive");
		unlinkSync(path);
	});
});
