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

export function formatLogRecord(record: LogRecord): string {
	const time = record.timestamp.slice(11, 23);
	const colorFn = LEVEL_COLORS[record.level];
	const levelStr = colorFn(record.level.toUpperCase().padEnd(5));
	const svc = record.service ? `[${pc.blue(record.service)}] ` : "";
	const proj =
		record.project || record.branch
			? `[${pc.magenta([record.project, record.branch].filter(Boolean).join("@"))}] `
			: "";
	const meta =
		record.meta && Object.keys(record.meta).length > 0
			? ` ${pc.dim(JSON.stringify(record.meta))}`
			: "";
	return `${pc.dim(time)} ${levelStr} ${proj}${svc}${record.message}${meta}`;
}

export function printLogRecord(record: LogRecord): void {
	const formatted = formatLogRecord(record);
	if (record.level === "error" || record.level === "fatal") {
		console.error(formatted);
	} else if (record.level === "warn") {
		console.warn(formatted);
	} else {
		console.log(formatted);
	}
}
