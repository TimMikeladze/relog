import type { RelogDatabase } from "../db/database.ts";
import type { AnalyticsConfig } from "../types.ts";

/**
 * Analytics retention runs on its own timer rather than joining the log
 * pruner because the two have opposite shapes: logs are pruned aggressively
 * by size to keep a debugging buffer, while analytics aggregates are the
 * product — they are meant to survive for years, and only the raw event
 * stream behind them is disposable.
 */

const DEFAULT_RAW_RETENTION_DAYS = 90;
const DEFAULT_AGGREGATE_RETENTION_DAYS = 730;
const INTERVAL_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

export interface AnalyticsPruneHandle {
	stop(): void;
	/** Exposed for tests and for an explicit admin-triggered sweep. */
	runOnce(): { rawDeleted: number; aggregatesDeleted: number };
}

export function pruneAnalyticsOnce(
	db: RelogDatabase,
	config: AnalyticsConfig,
	now: number = Date.now(),
): { rawDeleted: number; aggregatesDeleted: number } {
	const rawDays = config.rawRetentionDays ?? DEFAULT_RAW_RETENTION_DAYS;
	const aggDays = config.aggregateRetentionDays ?? DEFAULT_AGGREGATE_RETENTION_DAYS;

	// Deleting rollups while raw rows for the same period survive would make
	// `breakdown` silently prefer the raw table for a range the rollups no
	// longer cover, so aggregates must always outlive raw.
	const effectiveAggDays = Math.max(aggDays, rawDays);

	const rawDeleted = rawDays > 0 ? db.analytics.pruneRawEvents(now - rawDays * DAY_MS) : 0;
	const aggregatesDeleted =
		effectiveAggDays > 0 ? db.analytics.pruneAggregates(now - effectiveAggDays * DAY_MS) : 0;

	return { rawDeleted, aggregatesDeleted };
}

export function startAnalyticsPrune(
	db: RelogDatabase,
	config: AnalyticsConfig,
): AnalyticsPruneHandle {
	const runOnce = () => {
		try {
			const result = pruneAnalyticsOnce(db, config);
			if (result.rawDeleted > 0 || result.aggregatesDeleted > 0) {
				console.log(
					`[relog.sh] analytics retention: deleted ${result.rawDeleted} raw events, ${result.aggregatesDeleted} aggregate rows`,
				);
			}
			return result;
		} catch (err) {
			console.error("[relog.sh] analytics retention error:", err);
			return { rawDeleted: 0, aggregatesDeleted: 0 };
		}
	};

	const timer = setInterval(runOnce, INTERVAL_MS);
	// Never the reason the process stays alive.
	(timer as { unref?: () => void }).unref?.();

	return {
		stop() {
			clearInterval(timer);
		},
		runOnce,
	};
}
