import { type Command, command, string } from "@drizzle-team/brocli";
import pc from "picocolors";
import { authHeaders, resolveAuthHeader } from "./shared.ts";

export const statsCommand: Command = command({
	name: "stats",
	desc: "Show log statistics",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		auth: string().desc("Basic auth (user:pass). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const healthRes = await fetch(`${opts.url}/health`, {
			headers: resolveAuthHeader(opts.auth),
		});
		if (!healthRes.ok) {
			console.error(`Failed: ${healthRes.status}`);
			process.exit(1);
		}

		const health = (await healthRes.json()) as {
			ok: boolean;
			uptime: number;
			db_size_bytes: number;
			log_count: number;
		};

		const statsRes = await fetch(`${opts.url}/query`, {
			method: "POST",
			headers: authHeaders(opts.auth),
			body: JSON.stringify({
				sql: "SELECT level, COUNT(*) as count FROM logs GROUP BY level",
			}),
		});

		if (!statsRes.ok) {
			console.error(`Failed to fetch stats: ${statsRes.status}`);
			process.exit(1);
		}

		const statsData = (await statsRes.json()) as {
			rows: { level: string; count: number }[];
		};

		console.log(pc.bold("Relog Statistics"));
		console.log(`  Total logs:  ${pc.green(String(health.log_count))}`);
		console.log(`  DB size:     ${pc.cyan(formatBytes(health.db_size_bytes))}`);
		console.log(`  Uptime:      ${formatUptime(health.uptime)}`);
		console.log();
		console.log(pc.bold("By Level:"));
		for (const row of statsData.rows) {
			console.log(`  ${row.level.padEnd(8)} ${row.count}`);
		}
	},
});

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${h}h ${m}m`;
}
