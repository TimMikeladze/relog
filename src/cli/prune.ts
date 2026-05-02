import { type Command, boolean, command, number, string } from "@drizzle-team/brocli";
import { authHeaders } from "./shared.ts";

export const pruneCommand: Command = command({
	name: "prune",
	desc: "Delete old logs",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		before: string().desc("Delete logs before this ISO timestamp"),
		keepDays: number("keep-days").desc("Keep logs from the last N days"),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
		yes: boolean().desc("Skip confirmation prompt").default(false),
	},
	handler: async (opts) => {
		let beforeMs: number;

		if (opts.before) {
			beforeMs = new Date(opts.before).getTime();
			if (Number.isNaN(beforeMs)) {
				console.error("Invalid --before date format");
				process.exit(1);
			}
		} else if (opts.keepDays) {
			beforeMs = Date.now() - opts.keepDays * 86_400_000;
		} else {
			console.error("Provide --before or --keep-days");
			process.exit(1);
		}

		if (!opts.yes) {
			const cutoff = new Date(beforeMs).toISOString();
			process.stdout.write(`This will delete all logs before ${cutoff}. Continue? [y/N] `);
			const input = await new Promise<string>((resolve) => {
				const onData = (data: Buffer) => {
					process.stdin.off("end", onEnd);
					resolve(data.toString().trim().toLowerCase());
				};
				const onEnd = () => {
					process.stdin.off("data", onData);
					resolve("");
				};
				process.stdin.once("data", onData);
				process.stdin.once("end", onEnd);
			});
			if (input !== "y" && input !== "yes") {
				console.log("Aborted.");
				process.exit(0);
			}
		}

		const response = await fetch(`${opts.url}/prune`, {
			method: "POST",
			headers: authHeaders(opts.auth),
			body: JSON.stringify({ before: beforeMs }),
		});

		if (!response.ok) {
			console.error(`Prune failed: ${response.status}`);
			process.exit(1);
		}

		const result = (await response.json()) as { deleted: number };
		console.log(`Pruned ${result.deleted} logs`);
	},
});
