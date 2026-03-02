import { type Command, command, string } from "@drizzle-team/brocli";
import { printLogRecord } from "relog-client";
import type { LogRecord } from "relog-client";
import pc from "picocolors";
import { resolveAuth } from "./shared.ts";

export const tailCommand: Command = command({
	name: "tail",
	desc: "Stream logs in real-time",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		level: string().desc("Filter by log level"),
		service: string().desc("Filter by service name"),
		auth: string().desc("Basic auth (user:pass). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const params = new URLSearchParams();
		if (opts.level) params.set("level", opts.level);
		if (opts.service) params.set("service", opts.service);

		const headers: Record<string, string> = {};
		const auth = resolveAuth(opts.auth);
		if (auth) headers["Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;

		const qs = params.toString();
		const url = `${opts.url}/stream${qs ? `?${qs}` : ""}`;

		let retries = 0;
		const maxRetries = 10;

		while (retries < maxRetries) {
			try {
				const response = await fetch(url, { headers });
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

					for (const line of lines) {
						if (line.startsWith("event: error")) {
							const nextData = lines.find((l) =>
								l.startsWith("data: "),
							);
							console.error(
								nextData?.slice(6) ?? "Stream error",
							);
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
