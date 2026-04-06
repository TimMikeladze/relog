import type { IngestPayload } from "../types.ts";

export interface PullBatch {
	logs: IngestPayload[];
	/** Opaque bookmark — adapter-defined, relog just stores and returns it next time */
	cursor: string;
}

export interface SourceAdapter {
	name: string;
	pull(config: Record<string, unknown>, cursor: string | null): AsyncIterable<PullBatch>;
}

export interface SourceConfig {
	/** Adapter name (e.g. "github-actions") */
	adapter: string;
	/** Poll interval in seconds (minimum 10) */
	every: number;
	/** Stable identifier for cursor persistence. Auto-derived if omitted. */
	id?: string;
	/** Adapter-specific params — repo, token, project, etc. */
	[key: string]: unknown;
}
