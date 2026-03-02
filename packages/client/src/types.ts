export type { LogLevel, LogRecord } from "relog-shared";
export { LOG_LEVELS } from "relog-shared";
import type { LogLevel, LogRecord } from "relog-shared";

export interface LoggerOptions {
	url?: string;
	service?: string;
	auth?: string;
	level?: LogLevel;
	batchSize?: number;
	flushInterval?: number;
	maxBufferSize?: number;
	console?: boolean;
	meta?: Record<string, unknown>;
	traceId?: string;
	spanId?: string;
	onError?: (error: Error, batch: LogRecord[]) => void;
}
