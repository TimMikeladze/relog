import { type Command, command, number, string } from "@drizzle-team/brocli";
import { startServer } from "../server/server.ts";
import { resolveAuth } from "./shared.ts";

export const serveCommand: Command = command({
	name: "serve",
	desc: "Start the relog.dev server",
	options: {
		port: number().desc("Port to listen on").default(3485),
		db: string().desc("SQLite database path").default("relog.db"),
		auth: string().desc("Basic auth (user:pass). Also reads RELOG_AUTH env"),
		cors: string().desc("Enable CORS headers").default("false"),
	},
	handler: (opts) => {
		const auth = resolveAuth(opts.auth);
		const { server, shutdown } = startServer({
			port: opts.port,
			dbPath: opts.db,
			auth,
			cors: opts.cors === "true",
		});

		console.log(`relog.dev server listening on http://localhost:${server.port}`);
		console.log(`  database: ${opts.db}`);
		if (auth) console.log("  auth: enabled");
		if (opts.cors === "true") console.log("  cors: enabled");

		const onSignal = () => {
			console.log("\nShutting down...");
			shutdown();
			process.exit(0);
		};
		process.once("SIGINT", onSignal);
		process.once("SIGTERM", onSignal);
	},
});
