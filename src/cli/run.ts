import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { inferGitBranch, inferGitProject } from "../git.ts";
import { Transport } from "../transport.ts";
import type { LogLevel, LogRecord } from "../types.ts";
import { VALID_LEVELS } from "../types.ts";

const KNOWN_COMMANDS = new Set([
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
]);

const WRAP_FLAGS = new Set(["--url", "--service", "--auth"]);

export function isWrapMode(args: string[]): boolean {
	if (args.length === 0) return false;

	let i = 0;
	while (i < args.length) {
		const arg = args[i]!;
		if (arg === "--") return true;
		if (WRAP_FLAGS.has(arg)) {
			i += 2;
			continue;
		}
		if (arg.startsWith("-")) return false;
		if (arg === "run") return true;
		return !KNOWN_COMMANDS.has(arg);
	}

	return false;
}

interface WrapConfig {
	url: string;
	service: string;
	auth?: string;
	command: string[];
}

export function parseArgs(args: string[]): WrapConfig | null {
	let url: string | undefined;
	let service: string | undefined;
	let auth: string | undefined;
	let seenRun = false;

	let i = 0;
	while (i < args.length) {
		const arg = args[i]!;

		if (arg === "--") {
			return buildConfig(args.slice(i + 1), url, service, auth);
		}

		if (WRAP_FLAGS.has(arg)) {
			const val = args[i + 1];
			if (!val) return null;
			if (arg === "--url") url = val;
			else if (arg === "--service") service = val;
			else if (arg === "--auth") auth = val;
			i += 2;
			continue;
		}

		if (arg === "run" && !seenRun) {
			seenRun = true;
			i++;
			continue;
		}

		return buildConfig(args.slice(i), url, service, auth);
	}

	return null;
}

function buildConfig(
	command: string[],
	url?: string,
	service?: string,
	auth?: string,
): WrapConfig | null {
	if (command.length === 0) return null;
	return {
		url: url ?? process.env.RELOG_URL ?? "http://localhost:3485",
		service: service ?? inferService(command),
		auth: auth ?? process.env.RELOG_AUTH,
		command,
	};
}

function inferService(command: string[]): string {
	try {
		const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
		const pkg = JSON.parse(raw);
		if (typeof pkg.name === "string" && pkg.name.length > 0) return pkg.name;
	} catch {}
	return command[0] ?? "unknown";
}

// --- Log level detection ---

const ANSI_RE = /\x1b\[[0-9;]*m/g;

// Pino/Bunyan use numeric levels
const NUMERIC_LEVELS: Record<number, LogLevel> = {
	10: "trace",
	20: "debug",
	30: "info",
	40: "warn",
	50: "error",
	60: "fatal",
};

function normalizeLevel(raw: string): LogLevel {
	const lower = raw.toLowerCase();
	if (lower === "err") return "error";
	if (lower === "warning") return "warn";
	if (lower === "dbg") return "debug";
	if (VALID_LEVELS.has(lower)) return lower as LogLevel;
	return "info";
}

// Shared keyword group — matches common level names and abbreviations
const LVL = "FATAL|ERR(?:OR)?|WARN(?:ING)?|INFO|DEBUG|DBG|TRACE";

// Precompiled patterns — each requires structural context to avoid false positives
// Bracketed: [ERROR], [WARN], (INFO), etc.
const RE_BRACKET = new RegExp(`[\\[(](${LVL})[\\])]`, "i");
// Delimited: ERROR:, WARN -, INFO |  (preceded by start-of-string or whitespace)
const RE_DELIMITED = new RegExp(`(?:^|\\s)(${LVL})\\s*[:\\-|]`, "i");
// After ISO timestamp: 2024-01-01 12:00:00 ERROR ... (Java, Spring, Python logging)
const RE_AFTER_TS = new RegExp(
	`^\\d{4}[-/]\\d{2}[-/]\\d{2}[\\sT]\\d{2}:\\d{2}:\\d{2}[.,]?\\d*\\s+(${LVL})\\b`,
	"i",
);
// Logfmt: level=error, level="warn", etc. (Docker, Logrus, zerolog)
const RE_LOGFMT = new RegExp(`\\blevel="?(${LVL})"?\\b`, "i");
// Error class names: TypeError:, ValueError:, Error:, etc. (JS/Python/Java)
// Case-sensitive — real error classes are PascalCase, avoids matching plain "error" in prose
const RE_ERROR_CLASS = /\b\w*Error\s*:/;
// Python traceback header
const RE_TRACEBACK = /^Traceback\b/;
// Go panic
const RE_PANIC = /^panic:/i;

function detectLevelFromText(prefix: string): LogLevel | null {
	let m: RegExpMatchArray | null;

	m = prefix.match(RE_BRACKET);
	if (m) return normalizeLevel(m[1]!);

	m = prefix.match(RE_DELIMITED);
	if (m) return normalizeLevel(m[1]!);

	m = prefix.match(RE_AFTER_TS);
	if (m) return normalizeLevel(m[1]!);

	m = prefix.match(RE_LOGFMT);
	if (m) return normalizeLevel(m[1]!);

	// Error indicators — catches stderr lines that are real errors
	// (stderr defaults to "warn" so console.warn maps correctly;
	//  these patterns upgrade genuine errors back to "error")
	if (RE_ERROR_CLASS.test(prefix)) return "error";
	if (RE_TRACEBACK.test(prefix)) return "error";
	if (RE_PANIC.test(prefix)) return "error";

	return null;
}

export function detectLevel(
	line: string,
	defaultLevel: LogLevel,
): { level: LogLevel; message: string; meta?: Record<string, unknown> } {
	const clean = line.replace(ANSI_RE, "").trimStart();

	// --- JSON structured logs (Pino, Bunyan, Winston, structlog, etc.) ---
	if (clean.startsWith("{")) {
		try {
			const obj = JSON.parse(clean);
			if (typeof obj !== "object" || obj === null) throw 0;

			// Message field: "message" (Winston), "msg" (Pino/Bunyan)
			const message =
				typeof obj.message === "string"
					? obj.message
					: typeof obj.msg === "string"
						? obj.msg
						: null;
			if (!message) throw 0;

			// Level: string (Winston/structlog) or number (Pino/Bunyan)
			let lvl = defaultLevel;
			if (typeof obj.level === "string") {
				const lower = obj.level.toLowerCase();
				if (VALID_LEVELS.has(lower)) lvl = lower as LogLevel;
			} else if (typeof obj.level === "number") {
				const mapped = NUMERIC_LEVELS[obj.level];
				if (mapped) lvl = mapped;
			}
			// GCP Cloud Logging uses "severity"
			if (lvl === defaultLevel && typeof obj.severity === "string") {
				const lower = obj.severity.toLowerCase();
				if (VALID_LEVELS.has(lower)) lvl = lower as LogLevel;
			}

			const rest = { ...obj };
			delete rest.level;
			delete rest.msg;
			delete rest.message;
			delete rest.severity;
			return { level: lvl, message, meta: Object.keys(rest).length > 0 ? rest : undefined };
		} catch {}
	}

	// --- Text-based detection (check first 120 chars to avoid content false positives) ---
	const textLevel = detectLevelFromText(clean.slice(0, 120));
	if (textLevel) return { level: textLevel, message: line };

	return { level: defaultLevel, message: line };
}

// --- Stream processing ---

async function processStream(
	stream: ReadableStream<Uint8Array>,
	output: NodeJS.WriteStream,
	defaultLevel: LogLevel,
	onLine: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buf = "";

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;

		output.write(value);

		buf += decoder.decode(value, { stream: true });
		let idx: number;
		while ((idx = buf.indexOf("\n")) !== -1) {
			const line = buf.slice(0, idx).replace(/\r$/, "");
			buf = buf.slice(idx + 1);
			if (line.length > 0) {
				const { level, message, meta } = detectLevel(line, defaultLevel);
				onLine(level, message, meta);
			}
		}
	}

	if (buf.length > 0) {
		const { level, message, meta } = detectLevel(buf, defaultLevel);
		onLine(level, message, meta);
	}
}

// --- Main entry ---

export async function executeWrap(args: string[]): Promise<never> {
	const config = parseArgs(args);
	if (!config) {
		console.error("Usage: relog [--url URL] [--service NAME] [--auth TOKEN] <command...>");
		process.exit(1);
	}

	const { command, url, service, auth } = config;
	const project = inferGitProject();
	const branch = inferGitBranch();
	const host = hostname();

	const transport = new Transport({ url, auth, batchSize: 50, flushInterval: 2000 });

	const env: Record<string, string | undefined> = { ...process.env };
	if (process.stdout.isTTY && !env.FORCE_COLOR) {
		env.FORCE_COLOR = "1";
	}

	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn(command, {
			stdin: "inherit",
			stdout: "pipe",
			stderr: "pipe",
			env: env as Record<string, string>,
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`relog: failed to start '${command[0]}': ${msg}`);
		transport.destroy();
		process.exit(127);
	}

	// Let child handle SIGINT via process group; prevent relog from dying first
	process.on("SIGINT", () => {});
	process.on("SIGTERM", () => proc.kill());

	const handleLine = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
		const record: LogRecord = {
			timestamp: new Date().toISOString(),
			level,
			message,
			meta: meta ? { ...meta, source: "stdio" } : { source: "stdio" },
			service,
			host,
			pid: proc.pid,
			project,
			branch,
		};
		transport.send(record);
	};

	await Promise.all([
		proc.stdout
			? processStream(proc.stdout as ReadableStream<Uint8Array>, process.stdout, "info", handleLine)
			: Promise.resolve(),
		proc.stderr
			? processStream(proc.stderr as ReadableStream<Uint8Array>, process.stderr, "warn", handleLine)
			: Promise.resolve(),
	]);

	const exitCode = await proc.exited;
	await transport.flush();
	transport.destroy();

	process.exit(exitCode);
}
