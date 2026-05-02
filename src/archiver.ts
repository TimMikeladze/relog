import { S3Client } from "bun";
import { randomUUID } from "node:crypto";
import { parquetWriteBuffer } from "hyparquet-writer";
import type { ArchiveConfig, ArchiveBatchResult, LogEntry, RetryConfig } from "./types.ts";

export interface Partition {
	project: string;
	branch: string;
	year: string;
	month: string;
	day: string;
	logs: LogEntry[];
}

/**
 * Sanitize project/branch for use in S3 keys. Untrusted input from logs
 * could otherwise inject `../`, NULs, or whitespace into the object key
 * and address neighboring partitions or break the Hive layout.
 */
const SAFE_PARTITION_RE = /^[a-zA-Z0-9._-]+$/;
const MAX_PARTITION_LEN = 128;

export function sanitizePartition(value: string): string {
	if (!value) return "_default";
	const trimmed = value.slice(0, MAX_PARTITION_LEN);
	if (SAFE_PARTITION_RE.test(trimmed)) return trimmed;
	const replaced = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
	return replaced || "_default";
}

function partitionKey(project: string, branch: string, date: string): string {
	return `${project}/${branch}/${date}`;
}

export function groupByPartition(logs: LogEntry[]): Partition[] {
	const map = new Map<string, Partition>();

	for (const log of logs) {
		const project = sanitizePartition(log.project ?? "_default");
		const branch = sanitizePartition(log.branch ?? "_default");
		const d = new Date(log.created_at!);
		const year = String(d.getUTCFullYear());
		const month = String(d.getUTCMonth() + 1).padStart(2, "0");
		const day = String(d.getUTCDate()).padStart(2, "0");
		const key = partitionKey(project, branch, `${year}-${month}-${day}`);

		let partition = map.get(key);
		if (!partition) {
			partition = { project, branch, year, month, day, logs: [] };
			map.set(key, partition);
		}
		partition.logs.push(log);
	}

	return Array.from(map.values());
}

export function logsToParquet(logs: LogEntry[]): ArrayBuffer {
	// SQLite ROWIDs and pid_max can both exceed 2^31. Store as INT64 so a
	// long-lived instance never silently wraps an id/pid into negative space
	// in the archived parquet.
	const ids: bigint[] = [];
	const timestamps: string[] = [];
	const levels: string[] = [];
	const messages: string[] = [];
	const metas: string[] = [];
	const services: (string | null)[] = [];
	const hosts: (string | null)[] = [];
	const pids: (bigint | null)[] = [];
	const traceIds: (string | null)[] = [];
	const spanIds: (string | null)[] = [];
	const parentSpanIds: (string | null)[] = [];
	const projects: (string | null)[] = [];
	const branches: (string | null)[] = [];
	const versions: (string | null)[] = [];
	const deploymentIds: (string | null)[] = [];
	const durationMsValues: (number | null)[] = [];
	const keyPrefixes: (string | null)[] = [];
	const createdAts: bigint[] = [];

	for (const log of logs) {
		ids.push(BigInt(log.id!));
		timestamps.push(log.timestamp);
		levels.push(log.level);
		messages.push(log.message);
		metas.push(log.meta ? JSON.stringify(log.meta) : "");
		services.push(log.service ?? null);
		hosts.push(log.host ?? null);
		pids.push(log.pid != null ? BigInt(log.pid) : null);
		traceIds.push(log.trace_id ?? null);
		spanIds.push(log.span_id ?? null);
		parentSpanIds.push(log.parent_span_id ?? null);
		projects.push(log.project ?? null);
		branches.push(log.branch ?? null);
		versions.push(log.version ?? null);
		deploymentIds.push(log.deployment_id ?? null);
		durationMsValues.push(log.duration_ms ?? null);
		keyPrefixes.push(log.key_prefix ?? null);
		createdAts.push(BigInt(log.created_at!));
	}

	return parquetWriteBuffer({
		columnData: [
			{ name: "id", data: ids, type: "INT64" },
			{ name: "timestamp", data: timestamps, type: "STRING" },
			{ name: "level", data: levels, type: "STRING" },
			{ name: "message", data: messages, type: "STRING" },
			{ name: "meta", data: metas, type: "STRING" },
			{ name: "service", data: services, type: "STRING", nullable: true },
			{ name: "host", data: hosts, type: "STRING", nullable: true },
			{ name: "pid", data: pids, type: "INT64", nullable: true },
			{ name: "trace_id", data: traceIds, type: "STRING", nullable: true },
			{ name: "span_id", data: spanIds, type: "STRING", nullable: true },
			{ name: "parent_span_id", data: parentSpanIds, type: "STRING", nullable: true },
			{ name: "project", data: projects, type: "STRING", nullable: true },
			{ name: "branch", data: branches, type: "STRING", nullable: true },
			{ name: "version", data: versions, type: "STRING", nullable: true },
			{ name: "deployment_id", data: deploymentIds, type: "STRING", nullable: true },
			{ name: "duration_ms", data: durationMsValues, type: "DOUBLE", nullable: true },
			{ name: "key_prefix", data: keyPrefixes, type: "STRING", nullable: true },
			{ name: "created_at", data: createdAts, type: "INT64" },
		],
		codec: "SNAPPY",
	});
}

function s3Key(prefix: string, partition: Partition): string {
	// UUID ensures uniqueness across concurrent writers and process restarts;
	// `Date.now() + Math.random()` could collide and silently overwrite.
	const ts = Date.now();
	return `${prefix}/project=${partition.project}/branch=${partition.branch}/year=${partition.year}/month=${partition.month}/day=${partition.day}/${ts}-${randomUUID()}.parquet`;
}

async function retryUpload(fn: () => Promise<void>, retry: RetryConfig): Promise<void> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
		try {
			await fn();
			return;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < retry.maxRetries) {
				const delay = Math.min(
					retry.baseDelayMs * 2 ** attempt + Math.random() * retry.baseDelayMs,
					retry.maxDelayMs,
				);
				await Bun.sleep(delay);
			}
		}
	}
	throw lastError;
}

export async function archiveLogBatch(
	logs: LogEntry[],
	config: ArchiveConfig,
	retry?: RetryConfig,
): Promise<ArchiveBatchResult> {
	const client = new S3Client({
		endpoint: config.endpoint,
		bucket: config.bucket,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: config.region ?? "us-east-1",
	});

	const prefix = config.prefix ?? "logs";
	const retryConfig = retry ?? { maxRetries: 0, baseDelayMs: 1000, maxDelayMs: 30000 };
	const partitions = groupByPartition(logs);
	const succeededIds: number[] = [];
	let failed = 0;
	let partitionCount = 0;
	const errors: string[] = [];

	for (const partition of partitions) {
		const buffer = logsToParquet(partition.logs);
		const key = s3Key(prefix, partition);

		try {
			await retryUpload(async () => {
				await client.write(key, buffer, { type: "application/octet-stream" });
			}, retryConfig);
			partitionCount++;
			succeededIds.push(...partition.logs.map((l) => l.id!));
		} catch (err) {
			const msg = `Failed partition ${partition.project}/${partition.branch}/${partition.year}-${partition.month}-${partition.day}: ${err instanceof Error ? err.message : err}`;
			errors.push(msg);
			failed += partition.logs.length;
		}
	}

	return { succeededIds, failed, partitions: partitionCount, errors };
}
