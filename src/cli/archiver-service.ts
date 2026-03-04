import { type Command, command, number, string } from "@drizzle-team/brocli";
import { Baker } from "cronbake";
import type { ArchiveResult } from "../types.ts";

function log(level: "info" | "error", msg: string, data?: Record<string, unknown>): void {
	const entry = {
		ts: new Date().toISOString(),
		level,
		msg,
		service: "relog-archiver",
		...data,
	};
	if (level === "error") {
		console.error(JSON.stringify(entry));
	} else {
		console.log(JSON.stringify(entry));
	}
}

export const archiverServiceCommand: Command = command({
	name: "archiver-service",
	desc: "Run a standalone archiver service that calls the relog server's /archive endpoint",
	options: {
		url: string().desc("Relog server URL").default("http://localhost:3485"),
		auth: string().desc("Bearer token (API key) for authentication"),
		keepDays: number("keep-days").desc("Archive logs older than N days").default(7),
		cron: string()
			.desc("Cron expression for scheduling (6-field or preset like @every_30_seconds)")
			.default("0 0 * * * *"),
		maxRetries: number("max-retries").desc("Max retries per partition upload").default(3),
		baseDelay: number("base-delay").desc("Base retry delay in ms").default(1000),
		maxDelay: number("max-delay").desc("Max retry delay in ms").default(30000),
	},
	handler: (opts) => {
		let shuttingDown = false;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (opts.auth) {
			headers["Authorization"] = `Bearer ${opts.auth}`;
		}

		const baker = Baker.create({
			onError: (error, jobName) => {
				log("error", `job "${jobName}" error`, { error: error.message });
			},
		});

		baker.add({
			name: "archive",
			cron: opts.cron,
			overrunProtection: true,
			callback: async () => {
				if (shuttingDown) return;
				try {
					const response = await fetch(`${opts.url}/archive`, {
						method: "POST",
						headers,
						body: JSON.stringify({
							keepDays: opts.keepDays,
							retry: {
								maxRetries: opts.maxRetries,
								baseDelayMs: opts.baseDelay,
								maxDelayMs: opts.maxDelay,
							},
						}),
					});

					if (!response.ok) {
						const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
							error?: string;
						};
						log("error", "archive request failed", {
							status: response.status,
							error: body.error,
						});
						return;
					}

					const result = (await response.json()) as ArchiveResult;

					if (result.archived > 0 || result.failed > 0) {
						log("info", "archive complete", {
							archived: result.archived,
							failed: result.failed,
							partitions: result.partitions,
						});
					}
					for (const err of result.errors) {
						log("error", "partition failed", { detail: err });
					}
				} catch (err) {
					log("error", "archive request error", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			},
			onError: (error) => {
				log("error", "archive job error", { error: error.message });
			},
		});

		baker.bake("archive");

		log("info", "archiver service started", {
			url: opts.url,
			keepDays: opts.keepDays,
			cron: opts.cron,
			maxRetries: opts.maxRetries,
		});

		const shutdown = () => {
			if (shuttingDown) return;
			shuttingDown = true;
			log("info", "shutting down...");
			baker.destroyAll();
			process.exit(0);
		};

		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	},
});
