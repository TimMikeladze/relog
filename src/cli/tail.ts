import { type Command, command, string } from "@drizzle-team/brocli";
import { printLogRecord } from "../console.ts";
import type { LogRecord } from "../types.ts";
import pc from "picocolors";
import { buildParams, resolveAuthHeader } from "./shared.ts";

export const tailCommand: Command = command({
	name: "tail",
	desc: "Stream logs in real-time",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		level: string().desc("Filter by log level"),
		service: string().desc("Filter by service name"),
		project: string().desc("Filter by project"),
		branch: string().desc("Filter by branch"),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const params = buildParams({
			level: opts.level,
			service: opts.service,
			project: opts.project,
			branch: opts.branch,
		});

		const qs = params.toString();
		const url = `${opts.url}/stream${qs ? `?${qs}` : ""}`;

		let retries = 0;
		const maxRetries = 10;

		while (retries < maxRetries) {
			try {
				const response = await fetch(url, {
					headers: resolveAuthHeader(opts.auth),
				});
				if (!response.ok) {
					console.error(`Failed to connect: ${response.status}`);
					process.exit(1);
				}

				const reader = response.body?.getReader();
				if (!reader) {
					console.error("No response body");
					process.exit(1);
				}

				retries = 0;
				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (let i = 0; i < lines.length; i++) {
						const line = lines[i]!;
						if (line.startsWith("event: error")) {
							const nextLine = lines[i + 1];
							const msg = nextLine?.startsWith("data: ") ? nextLine.slice(6) : "Stream error";
							console.error(msg);
							process.exit(1);
						}
						if (!line.startsWith("data: ")) continue;
						const json = line.slice(6);
						try {
							const log = JSON.parse(json) as LogRecord;
							printLogRecord(log);
						} catch {
							// skip malformed lines
						}
					}
				}
			} catch {
				// connection lost
			}

			retries++;
			const delay = Math.min(2 ** retries * 500, 10000);
			console.error(pc.dim(`Connection lost. Reconnecting in ${delay / 1000}s...`));
			await new Promise((r) => setTimeout(r, delay));
		}

		console.error("Max reconnection attempts reached. Exiting.");
		process.exit(1);
	},
});
