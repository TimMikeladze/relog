import { existsSync, rmSync } from "node:fs";
import { type Command, boolean, string, command } from "@drizzle-team/brocli";
import { getDefaultDbPath } from "../paths.ts";

export const deleteDbCommand: Command = command({
	name: "delete-db",
	desc: "Delete the local relog database",
	options: {
		db: string().desc("Path to database file").default(getDefaultDbPath()),
		yes: boolean().desc("Skip confirmation prompt").default(false),
	},
	handler: async (opts) => {
		const dbPath = opts.db;

		if (!existsSync(dbPath)) {
			console.log(`No database found at ${dbPath}`);
			process.exit(0);
		}

		if (!opts.yes) {
			process.stdout.write(
				`This will permanently delete the database at ${dbPath}. Continue? [y/N] `,
			);
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

		rmSync(dbPath, { force: true });
		// Also remove WAL/SHM sidecar files if present
		for (const ext of [".wal", ".shm"]) {
			if (existsSync(dbPath + ext)) rmSync(dbPath + ext);
		}

		console.log(`Deleted ${dbPath}`);
	},
});
