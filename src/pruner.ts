import type { RelogDatabase } from "./db/database.ts";
import type { ArchiveConfig, AutoPruneConfig, RetryConfig } from "./types.ts";
import { archiveLogBatch } from "./archiver.ts";

const BATCH_SIZE = 5000;
const DEFAULT_RETRY: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 };

export interface PruneHandle {
	stop(): void;
	readonly archiveFailures: number;
}

export async function pruneByAge(
	db: RelogDatabase,
	maxAgeDays: number,
	archiveConfig?: ArchiveConfig,
	retry: RetryConfig = DEFAULT_RETRY,
): Promise<{ deleted: number; archiveBlocked: boolean }> {
	const cutoff = Date.now() - maxAgeDays * 86_400_000;

	if (!archiveConfig) {
		return { deleted: db.prune(cutoff), archiveBlocked: false };
	}

	let totalDeleted = 0;
	let archiveBlocked = false;
	for (;;) {
		const logs = db.getLogsForArchive(cutoff, BATCH_SIZE);
		if (logs.length === 0) break;

		const result = await archiveLogBatch(logs, archiveConfig, retry);
		if (result.succeededIds.length > 0) {
			db.deleteByIds(result.succeededIds);
			totalDeleted += result.succeededIds.length;
		}

		if (result.succeededIds.length === 0) {
			console.warn(
				`[relog.dev] auto-prune: archive failed for all partitions during age-based prune, stopping. errors: ${result.errors.join("; ")}`,
			);
			archiveBlocked = true;
			break;
		}
	}

	return { deleted: totalDeleted, archiveBlocked };
}

export async function pruneBySize(
	db: RelogDatabase,
	maxDbSize: number,
	archiveConfig?: ArchiveConfig,
	retry: RetryConfig = DEFAULT_RETRY,
): Promise<{ deleted: number; archiveBlocked: boolean }> {
	let totalDeleted = 0;
	let previousSize = db.getDbSize();
	let archiveBlocked = false;

	while (db.getDbSize() > maxDbSize) {
		const logs = db.getOldestLogs(BATCH_SIZE);
		if (logs.length === 0) break;

		if (archiveConfig) {
			const result = await archiveLogBatch(logs, archiveConfig, retry);
			if (result.succeededIds.length > 0) {
				db.deleteByIds(result.succeededIds);
				totalDeleted += result.succeededIds.length;
			}
			if (result.succeededIds.length === 0) {
				console.warn(
					`[relog.dev] auto-prune: archive failed for all partitions during size-based prune, stopping. errors: ${result.errors.join("; ")}`,
				);
				archiveBlocked = true;
				break;
			}
		} else {
			const ids = logs.map((l) => l.id!);
			db.deleteByIds(ids);
			totalDeleted += ids.length;
		}

		const currentSize = db.getDbSize();
		if (currentSize >= previousSize) {
			console.warn(
				`[relog.dev] auto-prune: DB size did not decrease after pruning (${currentSize} bytes >= ${previousSize} bytes, threshold ${maxDbSize} bytes) — stopping`,
			);
			break;
		}
		previousSize = currentSize;
	}

	return { deleted: totalDeleted, archiveBlocked };
}

export function startAutoPrune(
	db: RelogDatabase,
	pruneConfig: AutoPruneConfig,
	archiveConfig?: ArchiveConfig,
	onArchive?: () => Promise<void>,
): PruneHandle {
	const { maxDbSize, maxAgeDays, intervalSeconds = 60, retry: retryConfig } = pruneConfig;

	if (!maxDbSize && !maxAgeDays) {
		return {
			stop() {},
			get archiveFailures() {
				return 0;
			},
		};
	}

	let inFlight = false;
	let consecutiveArchiveFailures = 0;

	const timer = setInterval(async () => {
		if (inFlight) return;
		inFlight = true;

		try {
			let deleted = 0;
			let archiveBlocked = false;

			if (maxAgeDays) {
				const result = await pruneByAge(db, maxAgeDays, archiveConfig, retryConfig);
				deleted += result.deleted;
				if (result.archiveBlocked) archiveBlocked = true;
			}

			if (maxDbSize) {
				const result = await pruneBySize(db, maxDbSize, archiveConfig, retryConfig);
				deleted += result.deleted;
				if (result.archiveBlocked) archiveBlocked = true;
			}

			if (deleted > 0) {
				consecutiveArchiveFailures = 0;
				console.log(`[relog.dev] auto-prune: deleted ${deleted} logs`);
				if (archiveConfig && onArchive) {
					try {
						await onArchive();
					} catch (err) {
						console.error("[relog.dev] auto-prune: onArchive callback failed:", err);
					}
				}
			} else if (archiveBlocked) {
				consecutiveArchiveFailures++;
				if (consecutiveArchiveFailures >= 10) {
					console.error(
						`[relog.dev] CRITICAL: archive has failed ${consecutiveArchiveFailures} consecutive cycles — database may grow unbounded. Check S3 connectivity and credentials.`,
					);
				} else if (consecutiveArchiveFailures >= 3) {
					console.warn(
						`[relog.dev] auto-prune: archive has failed ${consecutiveArchiveFailures} consecutive cycles`,
					);
				}
			} else {
				consecutiveArchiveFailures = 0;
			}
		} catch (err) {
			console.error("[relog.dev] auto-prune error:", err);
		} finally {
			inFlight = false;
		}
	}, intervalSeconds * 1000);

	return {
		stop() {
			clearInterval(timer);
		},
		get archiveFailures() {
			return consecutiveArchiveFailures;
		},
	};
}
