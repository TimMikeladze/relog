import pc from "picocolors";
import type { LogLevel, LogRecord } from "./types.ts";

const LEVEL_COLORS: Record<LogLevel, (s: string) => string> = {
	trace: pc.gray,
	debug: pc.cyan,
	info: pc.green,
	warn: pc.yellow,
	error: pc.red,
	fatal: pc.bgRed,
};

// Save original console methods so printLogRecord always bypasses any overrides
export const originalConsole: {
	[K in "log" | "warn" | "error" | "debug" | "info" | "trace"]: (...args: unknown[]) => void;
} = {
	log: console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	debug: console.debug.bind(console),
	info: console.info.bind(console),
	trace: console.trace.bind(console),
};

export function formatLogRecord(record: LogRecord): string {
	const time = record.timestamp.slice(11, 23);
	const colorFn = LEVEL_COLORS[record.level];
	const levelStr = colorFn(record.level.toUpperCase().padEnd(5));
	const svc = record.service ? `[${pc.blue(record.service)}] ` : "";
	const projParts = [record.project, record.branch].filter(Boolean).join("@");
	const ver = record.version ? `v${record.version}` : "";
	const projLabel = [projParts, ver].filter(Boolean).join(" ");
	const proj = projLabel ? `[${pc.magenta(projLabel)}] ` : "";
	const duration =
		record.meta && typeof record.meta.duration_ms === "number"
			? ` ${pc.dim(`(${record.meta.duration_ms}ms)`)}`
			: "";
	const meta =
		record.meta && Object.keys(record.meta).length > 0
			? ` ${pc.dim(safeStringify(record.meta))}`
			: "";
	return `${pc.dim(time)} ${levelStr} ${proj}${svc}${record.message}${duration}${meta}`;
}

/**
 * `JSON.stringify` throws on BigInt and on circular references — both of
 * which leak into log meta when callers pass DB rows or driver objects
 * directly. A throw here aborts the local console formatter and the user
 * loses the log entirely. Coerce BigInt to string in a replacer; on any
 * remaining error (cycles, getters that throw), fall back to a marker so
 * the rest of the line still renders.
 */
function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
	} catch {
		return "[unserializable meta]";
	}
}

export function printLogRecord(record: LogRecord): void {
	const formatted = formatLogRecord(record);
	if (record.level === "error" || record.level === "fatal") {
		originalConsole.error(formatted);
	} else if (record.level === "warn") {
		originalConsole.warn(formatted);
	} else {
		originalConsole.log(formatted);
	}
}
