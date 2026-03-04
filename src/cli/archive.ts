import { type Command, command, number, string } from "@drizzle-team/brocli";
import { authHeaders } from "./shared.ts";

export const archiveCommand: Command = command({
	name: "archive",
	desc: "Trigger archival of old logs to S3/MinIO (S3 config must be set at server start via --s3-* flags)",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
		keepDays: number("keep-days").desc("Archive logs older than N days").default(7),
		maxRetries: number("max-retries").desc("Max retries per partition upload").default(3),
	},
	handler: async (opts) => {
		const headers = authHeaders(opts.auth);

		const body = {
			keepDays: opts.keepDays,
			retry: { maxRetries: opts.maxRetries },
		};

		try {
			const response = await fetch(`${opts.url}/archive`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});

			const result = (await response.json()) as {
				archived?: number;
				partitions?: number;
				error?: string;
			};

			if (!response.ok) {
				console.error(`Archive failed: ${result.error ?? response.statusText}`);
				process.exit(1);
			}

			console.log(`Archived ${result.archived} logs across ${result.partitions} partitions`);
		} catch (err) {
			console.error(`Failed to connect: ${err instanceof Error ? err.message : err}`);
			process.exit(1);
		}
	},
});
