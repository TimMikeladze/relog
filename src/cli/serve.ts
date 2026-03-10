import { type Command, boolean, command, number, string } from "@drizzle-team/brocli";
import { startServer } from "../server/server.ts";
import { getAppDistPath, getDefaultDbPath } from "../paths.ts";
import type { ArchiveConfig, AutoPruneConfig } from "../types.ts";
import { parseSize } from "./shared.ts";

const DEFAULT_MAX_DB_SIZE = "500mb";
const DEFAULT_MAX_AGE_DAYS = 30;

export const startCommand: Command = command({
	name: "start",
	desc: "Start the relog.dev server",
	options: {
		port: number().desc("Port to listen on").default(3485),
		db: string().desc("SQLite database path").default(getDefaultDbPath()),
		ingestKey: string("ingest-key").desc(
			"API key(s) for ingest role, comma-separated. Also reads RELOG_INGEST_KEY* env vars",
		),
		readKey: string("read-key").desc(
			"API key(s) for read role (includes ingest), comma-separated. Also reads RELOG_READ_KEY* env vars",
		),
		adminKey: string("admin-key").desc(
			"API key(s) for admin role (includes all), comma-separated. Also reads RELOG_ADMIN_KEY* env vars",
		),
		keyPrefixLength: number("key-prefix-length")
			.desc("Number of key characters stored per log for auditing (0 to disable)")
			.default(6),
		cors: string().desc("Enable CORS headers").default("false"),
		maxDbSize: string("max-db-size")
			.desc("Auto-prune when DB exceeds this size (e.g. 500mb, 1gb)")
			.default(DEFAULT_MAX_DB_SIZE),
		maxAgeDays: number("max-age-days").desc("Auto-prune logs older than N days").default(DEFAULT_MAX_AGE_DAYS),
		pruneInterval: number("prune-interval")
			.desc("Auto-prune check interval in seconds")
			.default(60),
		noPrune: boolean("no-prune").desc("Disable automatic pruning entirely"),
		s3Endpoint: string("s3-endpoint").desc("S3/MinIO endpoint for reading archived data"),
		s3Bucket: string("s3-bucket").desc("S3 bucket name for archived data"),
		s3AccessKey: string("s3-access-key").desc("S3 access key"),
		s3SecretKey: string("s3-secret-key").desc("S3 secret key"),
		s3Prefix: string("s3-prefix").desc("S3 path prefix").default("logs"),
		s3Region: string("s3-region").desc("S3 region").default("us-east-1"),
		s3UrlStyle: string("s3-url-style")
			.desc("S3 URL style: 'path' for MinIO/Tigris, 'vhost' for AWS S3")
			.default("path"),
		noUi: boolean("no-ui").desc("Disable serving the web UI"),
		noOpen: boolean("no-open").desc("Serve the web UI but skip opening it in the browser"),
	},
	handler: async (opts) => {
		function parseKeys(raw: string | undefined): string[] {
			if (!raw) return [];
			return raw
				.split(",")
				.map((k) => k.trim())
				.filter(Boolean);
		}

		function collectEnvKeys(prefix: string): string[] {
			const keys: string[] = [];
			for (const [name, value] of Object.entries(process.env)) {
				if (name.startsWith(prefix) && value) {
					keys.push(...parseKeys(value));
				}
			}
			return keys;
		}

		function resolveKeys(cliValue: string | undefined, envPrefix: string): string[] | undefined {
			const keys = [...parseKeys(cliValue), ...collectEnvKeys(envPrefix)];
			const unique = [...new Set(keys)];
			return unique.length ? unique : undefined;
		}

		const ingestKeys = resolveKeys(opts.ingestKey, "RELOG_INGEST_KEY");
		const readKeys = resolveKeys(opts.readKey, "RELOG_READ_KEY");
		const adminKeys = resolveKeys(opts.adminKey, "RELOG_ADMIN_KEY");

		let autoPrune: AutoPruneConfig | undefined;
		if (!opts.noPrune) {
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
				urlStyle: opts.s3UrlStyle as "path" | "vhost",
			};
		}

		const uiDistPath = opts.noUi ? undefined : (getAppDistPath() ?? undefined);

		const { server, shutdown } = await startServer({
			port: opts.port,
			dbPath: opts.db,
			ingestKeys,
			readKeys,
			adminKeys,
			keyPrefixLength: opts.keyPrefixLength,
			cors: opts.cors === "true",
			autoPrune,
			archive,
			uiDistPath,
		});

		const url = `http://localhost:${server.port}`;
		console.log(`relog.dev server listening on ${url}`);
		if (uiDistPath) console.log(`  ui: ${url}`);
		console.log(`  database: ${opts.db}`);
		const hasAuth = ingestKeys || readKeys || adminKeys;
		if (hasAuth) console.log("  auth: enabled (role-based API keys)");
		if (opts.cors === "true") console.log("  cors: enabled");
		if (autoPrune) {
			const parts: string[] = [];
			if (autoPrune.maxDbSize) parts.push(`max-db-size=${opts.maxDbSize}`);
			if (autoPrune.maxAgeDays) parts.push(`max-age=${autoPrune.maxAgeDays}d`);
			parts.push(`interval=${autoPrune.intervalSeconds}s`);
			console.log(`  auto-prune: ${parts.join(", ")}`);
		}

		if (uiDistPath && !opts.noOpen) {
			const opener =
				process.platform === "darwin"
					? "open"
					: process.platform === "win32"
						? "explorer"
						: "xdg-open";
			Bun.spawn([opener, url], { stdout: null, stderr: null });
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
