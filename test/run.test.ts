import { describe, expect, test } from "bun:test";
import { isWrapMode, parseArgs, detectLevel } from "../src/cli/run.ts";

// ---------------------------------------------------------------------------
// isWrapMode
// ---------------------------------------------------------------------------

describe("isWrapMode", () => {
	test("returns false for empty args", () => {
		expect(isWrapMode([])).toBe(false);
	});

	test("returns false for known subcommands", () => {
		for (const cmd of [
			"start",
			"send",
			"seed",
			"tail",
			"query",
			"search",
			"stats",
			"prune",
			"export",
			"mcp",
			"delete-db",
		]) {
			expect(isWrapMode([cmd])).toBe(false);
		}
	});

	test("returns false for --help and --version flags", () => {
		expect(isWrapMode(["--help"])).toBe(false);
		expect(isWrapMode(["--version"])).toBe(false);
		expect(isWrapMode(["-h"])).toBe(false);
	});

	test("returns true for unknown command (auto-detect)", () => {
		expect(isWrapMode(["bun", "run", "dev"])).toBe(true);
		expect(isWrapMode(["python", "app.py"])).toBe(true);
		expect(isWrapMode(["cargo", "run"])).toBe(true);
		expect(isWrapMode(["./my-script.sh"])).toBe(true);
	});

	test("returns true for explicit run subcommand", () => {
		expect(isWrapMode(["run", "bun", "run", "dev"])).toBe(true);
		expect(isWrapMode(["run", "python", "app.py"])).toBe(true);
	});

	test("returns true when relog flags precede the command", () => {
		expect(isWrapMode(["--url", "http://localhost:3485", "bun", "run", "dev"])).toBe(true);
		expect(isWrapMode(["--service", "api", "python", "app.py"])).toBe(true);
		expect(isWrapMode(["--auth", "tok", "--service", "api", "node", "index.js"])).toBe(true);
	});

	test("returns true for -- separator", () => {
		expect(isWrapMode(["--", "bun", "run", "dev"])).toBe(true);
		expect(isWrapMode(["--service", "api", "--", "python", "app.py"])).toBe(true);
	});

	test("returns false for relog flags followed by a known command", () => {
		expect(isWrapMode(["--url", "http://localhost:3485", "start"])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
	test("parses bare command", () => {
		const config = parseArgs(["bun", "run", "dev"]);
		expect(config).not.toBeNull();
		expect(config!.command).toEqual(["bun", "run", "dev"]);
		expect(config!.url).toBe("http://localhost:3485");
	});

	test("parses explicit run subcommand", () => {
		const config = parseArgs(["run", "python", "app.py"]);
		expect(config).not.toBeNull();
		expect(config!.command).toEqual(["python", "app.py"]);
	});

	test("parses --url flag", () => {
		const config = parseArgs(["--url", "http://logs:9000", "bun", "run", "dev"]);
		expect(config).not.toBeNull();
		expect(config!.url).toBe("http://logs:9000");
		expect(config!.command).toEqual(["bun", "run", "dev"]);
	});

	test("parses --service flag", () => {
		const config = parseArgs(["--service", "my-api", "node", "server.js"]);
		expect(config).not.toBeNull();
		expect(config!.service).toBe("my-api");
		expect(config!.command).toEqual(["node", "server.js"]);
	});

	test("parses --auth flag", () => {
		const config = parseArgs(["--auth", "secret-token", "cargo", "run"]);
		expect(config).not.toBeNull();
		expect(config!.auth).toBe("secret-token");
		expect(config!.command).toEqual(["cargo", "run"]);
	});

	test("parses all flags together", () => {
		const config = parseArgs([
			"--url",
			"http://logs:9000",
			"--service",
			"api",
			"--auth",
			"tok",
			"python",
			"manage.py",
			"runserver",
		]);
		expect(config).not.toBeNull();
		expect(config!.url).toBe("http://logs:9000");
		expect(config!.service).toBe("api");
		expect(config!.auth).toBe("tok");
		expect(config!.command).toEqual(["python", "manage.py", "runserver"]);
	});

	test("parses -- separator", () => {
		const config = parseArgs(["--service", "api", "--", "bun", "run", "dev"]);
		expect(config).not.toBeNull();
		expect(config!.service).toBe("api");
		expect(config!.command).toEqual(["bun", "run", "dev"]);
	});

	test("parses run + flags + separator", () => {
		const config = parseArgs(["run", "--service", "api", "--", "bun", "run", "dev"]);
		expect(config).not.toBeNull();
		expect(config!.service).toBe("api");
		expect(config!.command).toEqual(["bun", "run", "dev"]);
	});

	test("returns null for empty args", () => {
		expect(parseArgs([])).toBeNull();
	});

	test("returns null for run with no command", () => {
		expect(parseArgs(["run"])).toBeNull();
	});

	test("returns null for -- with no command after", () => {
		expect(parseArgs(["--"])).toBeNull();
	});

	test("returns null for flag missing value", () => {
		expect(parseArgs(["--url"])).toBeNull();
		expect(parseArgs(["--service"])).toBeNull();
	});

	test("infers service from package.json name", () => {
		const config = parseArgs(["echo", "hello"]);
		expect(config).not.toBeNull();
		expect(config!.service).toBe("relog.sh");
	});

	test("--service overrides package.json inference", () => {
		const config = parseArgs(["--service", "custom", "echo", "hello"]);
		expect(config).not.toBeNull();
		expect(config!.service).toBe("custom");
	});

	test("reads RELOG_URL env when no --url flag", () => {
		const orig = process.env.RELOG_URL;
		try {
			process.env.RELOG_URL = "http://env-url:3000";
			const config = parseArgs(["echo", "test"]);
			expect(config).not.toBeNull();
			expect(config!.url).toBe("http://env-url:3000");
		} finally {
			if (orig === undefined) delete process.env.RELOG_URL;
			else process.env.RELOG_URL = orig;
		}
	});

	test("--url flag overrides RELOG_URL env", () => {
		const orig = process.env.RELOG_URL;
		try {
			process.env.RELOG_URL = "http://env-url:3000";
			const config = parseArgs(["--url", "http://flag-url:4000", "echo", "test"]);
			expect(config).not.toBeNull();
			expect(config!.url).toBe("http://flag-url:4000");
		} finally {
			if (orig === undefined) delete process.env.RELOG_URL;
			else process.env.RELOG_URL = orig;
		}
	});
});

// ---------------------------------------------------------------------------
// detectLevel — JSON structured logs
// ---------------------------------------------------------------------------

describe("detectLevel: JSON", () => {
	describe("Winston-style (message + string level)", () => {
		test("parses level and message", () => {
			const r = detectLevel('{"level":"error","message":"conn failed","host":"web-1"}', "info");
			expect(r.level).toBe("error");
			expect(r.message).toBe("conn failed");
			expect(r.meta).toEqual({ host: "web-1" });
		});

		test("returns no meta when only level+message", () => {
			const r = detectLevel('{"level":"info","message":"clean"}', "error");
			expect(r.level).toBe("info");
			expect(r.meta).toBeUndefined();
		});

		test("uses default level when level field is invalid", () => {
			const r = detectLevel('{"level":"unknown","message":"hello"}', "warn");
			expect(r.level).toBe("warn");
		});
	});

	describe("Pino/Bunyan-style (msg + numeric level)", () => {
		test("parses numeric level 50 as error", () => {
			const r = detectLevel('{"level":50,"msg":"connection refused"}', "info");
			expect(r.level).toBe("error");
			expect(r.message).toBe("connection refused");
		});

		test("parses numeric level 30 as info", () => {
			const r = detectLevel('{"level":30,"msg":"server started","pid":1234}', "info");
			expect(r.level).toBe("info");
			expect(r.message).toBe("server started");
			expect(r.meta).toEqual({ pid: 1234 });
		});

		test("parses numeric level 10 as trace", () => {
			const r = detectLevel('{"level":10,"msg":"entering fn"}', "info");
			expect(r.level).toBe("trace");
		});

		test("parses numeric level 20 as debug", () => {
			const r = detectLevel('{"level":20,"msg":"cache hit"}', "info");
			expect(r.level).toBe("debug");
		});

		test("parses numeric level 40 as warn", () => {
			const r = detectLevel('{"level":40,"msg":"disk 90%"}', "info");
			expect(r.level).toBe("warn");
		});

		test("parses numeric level 60 as fatal", () => {
			const r = detectLevel('{"level":60,"msg":"OOM"}', "info");
			expect(r.level).toBe("fatal");
		});

		test("falls back to default for unknown numeric level", () => {
			const r = detectLevel('{"level":99,"msg":"custom"}', "info");
			expect(r.level).toBe("info");
		});
	});

	describe("GCP Cloud Logging (severity field)", () => {
		test("reads severity when no level field", () => {
			const r = detectLevel('{"severity":"error","message":"gcp error"}', "info");
			expect(r.level).toBe("error");
			expect(r.message).toBe("gcp error");
		});

		test("level field takes precedence over severity", () => {
			const r = detectLevel('{"level":"warn","severity":"error","message":"both"}', "info");
			expect(r.level).toBe("warn");
		});
	});

	describe("edge cases", () => {
		test("handles leading whitespace before JSON", () => {
			const r = detectLevel('  {"level":"debug","message":"indented"}', "info");
			expect(r.level).toBe("debug");
			expect(r.message).toBe("indented");
		});

		test("ignores JSON without message or msg field", () => {
			const r = detectLevel('{"level":"error","data":"no message key"}', "info");
			// Falls through to text pattern matching
			expect(r.message).toBe('{"level":"error","data":"no message key"}');
		});

		test("ignores non-object JSON", () => {
			const r = detectLevel("[1,2,3]", "info");
			expect(r.level).toBe("info");
		});

		test("ignores malformed JSON", () => {
			const r = detectLevel('{"level":"error, broken json', "info");
			expect(r.level).toBe("info");
		});

		test("strips severity from meta", () => {
			const r = detectLevel('{"severity":"warn","message":"test","extra":1}', "info");
			expect(r.meta).toEqual({ extra: 1 });
			expect(r.meta).not.toHaveProperty("severity");
		});

		test("strips msg from meta", () => {
			const r = detectLevel('{"level":30,"msg":"test","extra":1}', "info");
			expect(r.meta).toEqual({ extra: 1 });
			expect(r.meta).not.toHaveProperty("msg");
		});
	});
});

// ---------------------------------------------------------------------------
// detectLevel — text pattern matching
// ---------------------------------------------------------------------------

describe("detectLevel: text patterns", () => {
	describe("bracketed: [LEVEL] or (LEVEL)", () => {
		test("[ERROR]", () => {
			expect(detectLevel("[ERROR] something broke", "info").level).toBe("error");
		});
		test("[WARN]", () => {
			expect(detectLevel("[WARN] disk space low", "info").level).toBe("warn");
		});
		test("[WARNING]", () => {
			expect(detectLevel("[WARNING] deprecated call", "info").level).toBe("warn");
		});
		test("[INFO]", () => {
			expect(detectLevel("[INFO] server ready", "error").level).toBe("info");
		});
		test("[DEBUG]", () => {
			expect(detectLevel("[DEBUG] cache stats", "info").level).toBe("debug");
		});
		test("[TRACE]", () => {
			expect(detectLevel("[TRACE] entering fn", "info").level).toBe("trace");
		});
		test("[FATAL]", () => {
			expect(detectLevel("[FATAL] out of memory", "info").level).toBe("fatal");
		});
		test("(ERROR) parenthesized", () => {
			expect(detectLevel("(ERROR) crash", "info").level).toBe("error");
		});
		test("[ERR] abbreviated", () => {
			expect(detectLevel("[ERR] short form", "info").level).toBe("error");
		});
		test("[DBG] abbreviated", () => {
			expect(detectLevel("[DBG] verbose", "info").level).toBe("debug");
		});
		test("case insensitive: [error]", () => {
			expect(detectLevel("[error] lowercase brackets", "info").level).toBe("error");
		});
		test("with prefix: timestamp [ERROR]", () => {
			expect(detectLevel("14:32:05.123 [ERROR] connection timeout", "info").level).toBe("error");
		});
	});

	describe("delimited: LEVEL: or LEVEL - or LEVEL |", () => {
		test("ERROR:", () => {
			expect(detectLevel("ERROR: connection refused", "info").level).toBe("error");
		});
		test("error:", () => {
			expect(detectLevel("error: file not found", "info").level).toBe("error");
		});
		test("WARN:", () => {
			expect(detectLevel("WARN: slow query detected", "info").level).toBe("warn");
		});
		test("INFO -", () => {
			expect(detectLevel("INFO - request processed", "error").level).toBe("info");
		});
		test("ERROR |", () => {
			expect(detectLevel("ERROR | failed to connect", "info").level).toBe("error");
		});
		test("after whitespace: myapp ERROR:", () => {
			expect(detectLevel("myapp ERROR: crash", "info").level).toBe("error");
		});

		// Real-world: Rust compiler
		test("Rust error: error[E0308]:", () => {
			expect(detectLevel("error: could not compile `myapp`", "info").level).toBe("error");
		});

		// Real-world: PostgreSQL
		test("PostgreSQL LOG:", () => {
			// LOG is not in our patterns (intentionally — it maps to different levels per system)
			expect(detectLevel("LOG:  database system is ready", "info").level).toBe("info");
		});
	});

	describe("after timestamp (Java/Spring/Python logging)", () => {
		test("ISO timestamp + ERROR", () => {
			expect(detectLevel("2024-01-15 12:00:00.000 ERROR something failed", "info").level).toBe(
				"error",
			);
		});
		test("ISO timestamp + WARN", () => {
			expect(detectLevel("2024-01-15 12:00:00 WARN slow response", "info").level).toBe("warn");
		});
		test("ISO timestamp + INFO", () => {
			expect(detectLevel("2024-01-15T12:00:00.000 INFO app started", "error").level).toBe("info");
		});
		test("slash date + DEBUG", () => {
			expect(detectLevel("2024/01/15 12:00:00 DEBUG loading config", "info").level).toBe("debug");
		});

		// Real-world: Spring Boot
		test("Spring Boot log line", () => {
			expect(
				detectLevel(
					"2024-01-15 12:00:00.123  INFO 1234 --- [main] com.example.App : Started",
					"error",
				).level,
			).toBe("info");
		});

		// Real-world: Python logging
		test("Python logging format", () => {
			expect(
				detectLevel("2024-01-15 12:00:00,123 ERROR django.request: Internal Server Error", "info")
					.level,
			).toBe("error");
		});
	});

	describe("logfmt: level=LEVEL", () => {
		test("level=error", () => {
			expect(
				detectLevel('time="2024-01-15T12:00:00Z" level=error msg="failed"', "info").level,
			).toBe("error");
		});
		test("level=info", () => {
			expect(
				detectLevel('time="2024-01-15T12:00:00Z" level=info msg="started"', "error").level,
			).toBe("info");
		});
		test("level=warn", () => {
			expect(
				detectLevel('ts=2024-01-15 level=warn caller=main.go:42 msg="slow"', "info").level,
			).toBe("warn");
		});
		test('level="error" (quoted)', () => {
			expect(detectLevel('time=2024-01-15 level="error" msg="crash"', "info").level).toBe("error");
		});

		// Real-world: Docker / Logrus
		test("Docker/Logrus format", () => {
			expect(
				detectLevel(
					'time="2024-01-15T12:00:00.000Z" level=warning msg="container unhealthy"',
					"info",
				).level,
			).toBe("warn");
		});
	});

	describe("ANSI color codes", () => {
		test("detects level through ANSI codes", () => {
			expect(detectLevel("\x1b[31m[ERROR]\x1b[0m red error", "info").level).toBe("error");
		});
		test("detects delimited level through ANSI", () => {
			expect(detectLevel("\x1b[33mWARN:\x1b[0m yellow warning", "info").level).toBe("warn");
		});
		test("parses JSON through ANSI", () => {
			const r = detectLevel('\x1b[2m{"level":"warn","message":"colored"}\x1b[0m', "info");
			expect(r.level).toBe("warn");
			expect(r.message).toBe("colored");
		});
	});

	describe("preserves original line as message", () => {
		test("brackets", () => {
			const line = "[ERROR] something broke";
			expect(detectLevel(line, "info").message).toBe(line);
		});
		test("delimited", () => {
			const line = "ERROR: something broke";
			expect(detectLevel(line, "info").message).toBe(line);
		});
	});
});

// ---------------------------------------------------------------------------
// detectLevel — false positive prevention
// ---------------------------------------------------------------------------

describe("detectLevel: false positives", () => {
	test("info@example.com should NOT detect as INFO", () => {
		expect(detectLevel("Contact: info@example.com", "info").level).toBe("info"); // default, not detected
		// The key is: it should use the default, not "detect" INFO from the email
		const r = detectLevel("Contact: info@example.com", "error");
		expect(r.level).toBe("error"); // keeps the default, no false detection
	});

	test('"No error found" should NOT detect as ERROR', () => {
		const r = detectLevel("No error found", "info");
		expect(r.level).toBe("info"); // default, not ERROR
	});

	test('"Handling error boundary" should NOT detect as ERROR', () => {
		const r = detectLevel("Handling error boundary", "info");
		expect(r.level).toBe("info");
	});

	test('"/path/to/debug/file.js" should NOT detect as DEBUG', () => {
		const r = detectLevel("Loading /path/to/debug/file.js", "info");
		expect(r.level).toBe("info");
	});

	test('"error_count: 0" should NOT detect as ERROR', () => {
		const r = detectLevel("error_count: 0, warn_count: 0", "info");
		expect(r.level).toBe("info");
	});

	test('"sending error notification" should NOT detect as ERROR', () => {
		const r = detectLevel("sending error notification to admin", "info");
		expect(r.level).toBe("info");
	});

	test('"Created 0 errors, 5 warnings" should NOT detect as ERROR', () => {
		const r = detectLevel("Created 0 errors, 5 warnings", "info");
		expect(r.level).toBe("info");
	});

	test('"The debug panel is visible" should NOT detect as DEBUG', () => {
		const r = detectLevel("The debug panel is visible", "info");
		expect(r.level).toBe("info");
	});

	test("plain URLs should not false-match", () => {
		const r = detectLevel("GET /api/info/users 200 12ms", "info");
		expect(r.level).toBe("info"); // stays default, not detected from path
	});

	test("server started on port should stay default", () => {
		const r = detectLevel("Server listening on port 3000", "info");
		expect(r.level).toBe("info");
	});

	test("compiling... should stay default", () => {
		const r = detectLevel("Compiling TypeScript...", "info");
		expect(r.level).toBe("info");
	});
});

// ---------------------------------------------------------------------------
// detectLevel — error indicators (upgrades stderr "warn" default to "error")
// ---------------------------------------------------------------------------

describe("detectLevel: error indicators", () => {
	// These tests use default "warn" to simulate stderr, where we want real
	// errors upgraded to "error" but plain console.warn output to stay "warn".

	describe("JS/Python/Java error class names", () => {
		test("Error:", () => {
			expect(detectLevel("Error: something broke", "warn").level).toBe("error");
		});
		test("TypeError:", () => {
			expect(detectLevel("TypeError: Cannot read properties of undefined", "warn").level).toBe(
				"error",
			);
		});
		test("ReferenceError:", () => {
			expect(detectLevel("ReferenceError: foo is not defined", "warn").level).toBe("error");
		});
		test("SyntaxError:", () => {
			expect(detectLevel("SyntaxError: Unexpected token", "warn").level).toBe("error");
		});
		test("RangeError:", () => {
			expect(detectLevel("RangeError: Maximum call stack size exceeded", "warn").level).toBe(
				"error",
			);
		});
		test("ValueError (Python):", () => {
			expect(detectLevel("ValueError: invalid literal for int()", "warn").level).toBe("error");
		});
		test("NullPointerException (Java):", () => {
			// Java format uses Exception not Error, but followed by :
			// Our RE_DELIMITED won't catch this, but if it contains "Error:" somewhere...
			// Actually NullPointerException doesn't match \w*Error — this stays warn
			// which is acceptable since the preceding "Exception in thread" line would be caught
			expect(detectLevel("NullPointerException: null", "warn").level).toBe("warn");
		});
		test("CustomAppError:", () => {
			expect(detectLevel("CustomAppError: user not found", "warn").level).toBe("error");
		});
		test("Unhandled Error: with prefix", () => {
			expect(detectLevel("Unhandled Error: promise rejection", "warn").level).toBe("error");
		});
	});

	describe("Python traceback", () => {
		test("Traceback header", () => {
			expect(detectLevel("Traceback (most recent call last):", "warn").level).toBe("error");
		});
	});

	describe("Go panic", () => {
		test("panic: at start of line", () => {
			expect(detectLevel("panic: runtime error: index out of range", "warn").level).toBe("error");
		});
	});

	describe("console.warn vs console.error simulation", () => {
		test("plain text on stderr defaults to warn (console.warn behavior)", () => {
			// console.warn("slow query") → stderr → "slow query" → no pattern → warn
			expect(detectLevel("slow query detected", "warn").level).toBe("warn");
		});
		test("plain text on stderr stays warn, not error", () => {
			// console.warn("careful") → stderr → "careful" → no pattern → warn
			expect(detectLevel("careful with that input", "warn").level).toBe("warn");
		});
		test("Error: on stderr upgrades to error (console.error + Error obj)", () => {
			// console.error(new Error("x")) → stderr → "Error: x" → pattern → error
			expect(detectLevel("Error: connection timeout", "warn").level).toBe("error");
		});
		test("TypeError: on stderr upgrades to error", () => {
			// Node.js uncaught TypeError → stderr → error
			expect(
				detectLevel("TypeError: Cannot read properties of undefined (reading 'map')", "warn").level,
			).toBe("error");
		});
	});
});

// ---------------------------------------------------------------------------
// detectLevel — default fallback
// ---------------------------------------------------------------------------

describe("detectLevel: default fallback", () => {
	test("plain text uses provided default", () => {
		expect(detectLevel("hello world", "info").level).toBe("info");
		expect(detectLevel("hello world", "error").level).toBe("error");
		expect(detectLevel("hello world", "debug").level).toBe("debug");
	});

	test("returns original line as message", () => {
		const r = detectLevel("just a line", "info");
		expect(r.message).toBe("just a line");
		expect(r.meta).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Integration: full wrap with subprocess
// ---------------------------------------------------------------------------

describe("executeWrap integration", () => {
	test("captures stdout and exits with child exit code 0", async () => {
		const proc = Bun.spawn(["bun", "src/cli.ts", "echo", "hello world"], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, RELOG_URL: "http://127.0.0.1:1" },
		});

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(stdout.trim()).toBe("hello world");
		expect(exitCode).toBe(0);
	});

	test("captures stderr and forwards child exit code", async () => {
		const proc = Bun.spawn(["bun", "src/cli.ts", "bash", "-c", "echo oops >&2; exit 42"], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, RELOG_URL: "http://127.0.0.1:1" },
		});

		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		expect(stderr).toContain("oops");
		expect(exitCode).toBe(42);
	});

	test("explicit run subcommand works", async () => {
		const proc = Bun.spawn(["bun", "src/cli.ts", "run", "echo", "via run"], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, RELOG_URL: "http://127.0.0.1:1" },
		});

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(stdout.trim()).toBe("via run");
		expect(exitCode).toBe(0);
	});

	test("command not found exits with 127", async () => {
		const proc = Bun.spawn(["bun", "src/cli.ts", "nonexistent-binary-xyz"], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, RELOG_URL: "http://127.0.0.1:1" },
		});

		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		expect(stderr).toContain("failed to start");
		expect(exitCode).toBe(127);
	});

	test("multi-line output is fully captured", async () => {
		const proc = Bun.spawn(
			["bun", "src/cli.ts", "bash", "-c", "echo line1; echo line2; echo line3"],
			{
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, RELOG_URL: "http://127.0.0.1:1" },
			},
		);

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(stdout).toContain("line1");
		expect(stdout).toContain("line2");
		expect(stdout).toContain("line3");
		expect(exitCode).toBe(0);
	});

	test("known subcommands are not intercepted by wrap mode", async () => {
		const proc = Bun.spawn(["bun", "src/cli.ts", "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(stdout).toContain("Available Commands");
		expect(exitCode).toBe(0);
	});

	test("relog flags are consumed, not passed to child", async () => {
		const proc = Bun.spawn(
			[
				"bun",
				"src/cli.ts",
				"--service",
				"my-svc",
				"--url",
				"http://127.0.0.1:1",
				"echo",
				"flag-test",
			],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(stdout.trim()).toBe("flag-test");
		expect(exitCode).toBe(0);
	});

	test("-- separator correctly splits relog args from command", async () => {
		const proc = Bun.spawn(
			["bun", "src/cli.ts", "--service", "svc", "--", "echo", "--service", "not-consumed"],
			{
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, RELOG_URL: "http://127.0.0.1:1" },
			},
		);

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(stdout.trim()).toBe("--service not-consumed");
		expect(exitCode).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Integration: server-less CLI behaviour
// ---------------------------------------------------------------------------

// Port 1 is privileged and never listening, so the connection is refused
// immediately rather than hanging until a timeout.
const DEAD_URL = "http://127.0.0.1:1";

describe("unreachable server diagnostics", () => {
	// Bun raises the same opaque "Unable to connect" for every transport
	// failure. On its own it reads like a network fault, so each one-shot
	// command has to name the address it tried and how to bring a server up.
	for (const args of [
		["stats"],
		["query", "--sql", "select 1"],
		["search"],
		["send", "--message", "hi"],
	]) {
		test(`${args[0]} names the address and how to recover`, async () => {
			const proc = Bun.spawn(["bun", "src/cli.ts", ...args, "--url", DEAD_URL], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const stderr = await new Response(proc.stderr).text();
			const exitCode = await proc.exited;

			expect(stderr).toContain(DEAD_URL);
			expect(stderr).toContain("relog start");
			expect(exitCode).toBe(1);
		});
	}
});

describe("query --db", () => {
	async function seedDb(path: string): Promise<void> {
		const { RelogDatabase } = await import("../src/db/database.ts");
		const db = new RelogDatabase(path);
		db.insert([{ level: "info", message: "from a file" }]);
		db.close();
	}

	test("reads a database file with no server running", async () => {
		const path = `test-query-db-${Date.now()}.db`;
		await seedDb(path);

		try {
			const proc = Bun.spawn(
				[
					"bun",
					"src/cli.ts",
					"query",
					"--db",
					path,
					"--sql",
					"select message from logs",
					"--format",
					"json",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);

			const stdout = await new Response(proc.stdout).text();
			const exitCode = await proc.exited;

			expect(exitCode).toBe(0);
			expect(JSON.parse(stdout)).toEqual([{ message: "from a file" }]);
		} finally {
			await Bun.file(path)
				.delete()
				.catch(() => {});
		}
	});

	test("still refuses writes", async () => {
		const path = `test-query-db-ro-${Date.now()}.db`;
		await seedDb(path);

		try {
			const proc = Bun.spawn(
				["bun", "src/cli.ts", "query", "--db", path, "--sql", "delete from logs"],
				{ stdout: "pipe", stderr: "pipe" },
			);

			const stderr = await new Response(proc.stderr).text();
			const exitCode = await proc.exited;

			expect(stderr).toContain("rejected");
			expect(exitCode).toBe(1);
		} finally {
			await Bun.file(path)
				.delete()
				.catch(() => {});
		}
	});

	test("reports an unopenable path rather than a stack trace", async () => {
		const proc = Bun.spawn(
			["bun", "src/cli.ts", "query", "--db", "does-not-exist.db", "--sql", "select 1"],
			{ stdout: "pipe", stderr: "pipe" },
		);

		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		expect(stderr).toContain("Cannot open");
		expect(stderr).toContain("does-not-exist.db");
		expect(exitCode).toBe(1);
	});
});
