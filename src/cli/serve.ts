import { type Command, command, number, string } from "@drizzle-team/brocli";
import { startServer } from "../server/server.ts";
import type { ArchiveConfig, AutoPruneConfig } from "../types.ts";

function parseSize(s: string): number {
	const match = s.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i);
	if (!match) {
		const n = Number(s);
		if (Number.isNaN(n)) throw new Error(`Invalid size: ${s}`);
		return n;
	}
	const value = Number.parseFloat(match[1]!);
	const unit = match[2]!.toLowerCase();
	const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
	return Math.floor(value * multipliers[unit]!);
}

export const startCommand: Command = command({
	name: "start",
	desc: "Start the relog.dev server",
	options: {
		port: number().desc("Port to listen on").default(3485),
		db: string().desc("SQLite database path").default("relog.db"),
		ingestKey: string("ingest-key").desc(
			"API key for ingest role. Also reads RELOG_INGEST_KEY env",
		),
		readKey: string("read-key").desc(
			"API key for read role (includes ingest). Also reads RELOG_READ_KEY env",
		),
		adminKey: string("admin-key").desc(
			"API key for admin role (includes all). Also reads RELOG_ADMIN_KEY env",
		),
		cors: string().desc("Enable CORS headers").default("false"),
		maxDbSize: string("max-db-size").desc("Auto-prune when DB exceeds this size (e.g. 500mb, 1gb)"),
		maxAgeDays: number("max-age-days").desc("Auto-prune logs older than N days"),
		pruneInterval: number("prune-interval")
			.desc("Auto-prune check interval in seconds")
			.default(60),
		s3Endpoint: string("s3-endpoint").desc("S3/MinIO endpoint for reading archived data"),
		s3Bucket: string("s3-bucket").desc("S3 bucket name for archived data"),
		s3AccessKey: string("s3-access-key").desc("S3 access key"),
		s3SecretKey: string("s3-secret-key").desc("S3 secret key"),
		s3Prefix: string("s3-prefix").desc("S3 path prefix").default("logs"),
		s3Region: string("s3-region").desc("S3 region").default("us-east-1"),
	},
	handler: async (opts) => {
		const ingestKey = opts.ingestKey ?? process.env.RELOG_INGEST_KEY;
		const readKey = opts.readKey ?? process.env.RELOG_READ_KEY;
		const adminKey = opts.adminKey ?? process.env.RELOG_ADMIN_KEY;

		let autoPrune: AutoPruneConfig | undefined;
		if (opts.maxDbSize || opts.maxAgeDays) {
			autoPrune = {
				maxDbSize: opts.maxDbSize ? parseSize(opts.maxDbSize) : undefined,
				maxAgeDays: opts.maxAgeDays,
				intervalSeconds: opts.pruneInterval,
			};
		}

		let archive: ArchiveConfig | undefined;
		if (opts.s3Endpoint && opts.s3Bucket && opts.s3AccessKey && opts.s3SecretKey) {
			archive = {
				endpoint: opts.s3Endpoint,
				bucket: opts.s3Bucket,
				accessKeyId: opts.s3AccessKey,
				secretAccessKey: opts.s3SecretKey,
				prefix: opts.s3Prefix,
				region: opts.s3Region,
			};
		}

		const { server, shutdown } = await startServer({
			port: opts.port,
			dbPath: opts.db,
			ingestKey,
			readKey,
			adminKey,
			cors: opts.cors === "true",
			autoPrune,
			archive,
		});

		console.log(`relog.dev server listening on http://localhost:${server.port}`);
		console.log(`  database: ${opts.db}`);
		const hasAuth = ingestKey || readKey || adminKey;
		if (hasAuth) console.log("  auth: enabled (role-based API keys)");
		if (opts.cors === "true") console.log("  cors: enabled");
		if (autoPrune) {
			const parts: string[] = [];
			if (autoPrune.maxDbSize) parts.push(`max-db-size=${opts.maxDbSize}`);
			if (autoPrune.maxAgeDays) parts.push(`max-age=${autoPrune.maxAgeDays}d`);
			parts.push(`interval=${autoPrune.intervalSeconds}s`);
			console.log(`  auto-prune: ${parts.join(", ")}`);
		}

		const onSignal = () => {
			console.log("\nShutting down...");
			shutdown();
			process.exit(0);
		};
		process.once("SIGINT", onSignal);
		process.once("SIGTERM", onSignal);
	},
});
