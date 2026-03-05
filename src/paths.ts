import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DATA_DIR = join(homedir(), ".relog");

export function getDataDir(): string {
	mkdirSync(DATA_DIR, { recursive: true });
	return DATA_DIR;
}

export function getDefaultDbPath(): string {
	return join(getDataDir(), "relog.db");
}
