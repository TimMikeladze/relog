import type { RelogDatabase } from "../db/database.ts";
import type { StreamManager } from "../server/routes/stream.ts";
import type { SourceConfig } from "./types.ts";
import { getAdapter } from "./registry.ts";
import { deriveSourceId } from "./config.ts";
import { GitHubRateLimitError } from "./adapters/github-actions.ts";

export interface SourcesHandle {
	stop(): Promise<void>;
}

const MAX_BACKOFF_SECONDS = 3600;
const MAX_BACKOFF_EXPONENT = 6;

export function startSources(
	db: RelogDatabase,
	streamManager: StreamManager,
	configs: SourceConfig[],
): SourcesHandle {
	const timers: ReturnType<typeof setInterval>[] = [];
	const inFlightPromises: Promise<void>[] = [];
	let stopped = false;

	for (const config of configs) {
		const adapter = getAdapter(config.adapter);
		const sourceId = deriveSourceId(config);
		let inFlight = false;
		let consecutiveFailures = 0;
		let nextAttemptAt = 0;

		const tick = async () => {
			if (stopped) return;
			if (inFlight) return;
			if (Date.now() < nextAttemptAt) return;
			inFlight = true;

			const done = Promise.resolve().then(async () => {
				try {
					const cursor = db.getCursor(sourceId);
					let totalIngested = 0;

					for await (const batch of adapter.pull(config, cursor)) {
						if (stopped) break;
						if (batch.logs.length > 0) {
							// Atomic: insert logs + save cursor in one transaction
							db.insertAndSetCursor(batch.logs, sourceId, batch.cursor);
							totalIngested += batch.logs.length;
							streamManager.notify();
						} else if (batch.cursor) {
							// cursor-only advance — no new log rows, skip stream notification
							db.setCursor(sourceId, batch.cursor);
						}
					}

					if (totalIngested > 0) {
						console.log(`[relog.dev] source ${sourceId}: ingested ${totalIngested} logs`);
					}

					consecutiveFailures = 0;
				} catch (err) {
					consecutiveFailures++;

					// Use rate-limit retryAfter when available
					let backoffSeconds: number;
					if (err instanceof GitHubRateLimitError) {
						backoffSeconds = Math.max(err.retryAfter, config.every);
					} else {
						backoffSeconds = Math.min(
							config.every * 2 ** Math.min(consecutiveFailures, MAX_BACKOFF_EXPONENT),
							MAX_BACKOFF_SECONDS,
						);
					}

					nextAttemptAt = Date.now() + backoffSeconds * 1000;
					console.error(
						`[relog.dev] source ${sourceId} error (failure #${consecutiveFailures}, backoff ${backoffSeconds}s):`,
						err,
					);
				} finally {
					inFlight = false;
				}
			});

			inFlightPromises.push(done);
			done.finally(() => {
				const idx = inFlightPromises.indexOf(done);
				if (idx !== -1) inFlightPromises.splice(idx, 1);
			});
		};

		// Run immediately on startup, then on interval
		tick();
		timers.push(setInterval(tick, config.every * 1000));
	}

	return {
		async stop() {
			stopped = true;
			for (const timer of timers) {
				clearInterval(timer);
			}
			// Wait for any in-flight ticks to finish before returning
			await Promise.all(inFlightPromises);
		},
	};
}
