import type { RelogDatabase } from "../db/database.ts";
import type { StreamManager } from "../server/routes/stream.ts";
import type { SourceConfig } from "./types.ts";
import { getAdapter } from "./registry.ts";
import { deriveSourceId } from "./config.ts";

export interface SourcesHandle {
	stop(): void;
}

const MAX_BACKOFF_SECONDS = 3600;
const MAX_BACKOFF_EXPONENT = 6;

export function startSources(
	db: RelogDatabase,
	streamManager: StreamManager,
	configs: SourceConfig[],
): SourcesHandle {
	const timers: ReturnType<typeof setInterval>[] = [];

	for (const config of configs) {
		const adapter = getAdapter(config.adapter);
		const sourceId = deriveSourceId(config);
		let inFlight = false;
		let consecutiveFailures = 0;
		let nextAttemptAt = 0;

		const tick = async () => {
			if (inFlight) return;
			if (Date.now() < nextAttemptAt) return;
			inFlight = true;

			try {
				const cursor = db.getCursor(sourceId);
				let totalIngested = 0;

				for await (const batch of adapter.pull(config, cursor)) {
					if (batch.logs.length > 0) {
						// Atomic: insert logs + save cursor in one transaction
						db.insertAndSetCursor(batch.logs, sourceId, batch.cursor);
						totalIngested += batch.logs.length;
						streamManager.notify();
					} else if (batch.cursor) {
						// No logs but cursor advanced (e.g. skipped runs)
						db.setCursor(sourceId, batch.cursor);
					}
				}

				if (totalIngested > 0) {
					console.log(
						`[relog.dev] source ${sourceId}: ingested ${totalIngested} logs`,
					);
				}

				consecutiveFailures = 0;
			} catch (err) {
				consecutiveFailures++;
				const backoffSeconds = Math.min(
					config.every * 2 ** Math.min(consecutiveFailures, MAX_BACKOFF_EXPONENT),
					MAX_BACKOFF_SECONDS,
				);
				nextAttemptAt = Date.now() + backoffSeconds * 1000;
				console.error(
					`[relog.dev] source ${sourceId} error (failure #${consecutiveFailures}, backoff ${backoffSeconds}s):`,
					err,
				);
			} finally {
				inFlight = false;
			}
		};

		// Run immediately on startup, then on interval
		tick();
		timers.push(setInterval(tick, config.every * 1000));
	}

	return {
		stop() {
			for (const timer of timers) {
				clearInterval(timer);
			}
		},
	};
}
