import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const DATA_DIR = join(homedir(), ".relog");

export function getDataDir(): string {
	mkdirSync(DATA_DIR, { recursive: true });
	return DATA_DIR;
}

export function getDefaultDbPath(): string {
	return join(getDataDir(), "relog.db");
}

export function getAppDistPath(): string | null {
	// Production: app files are copied to dist/app/ alongside the compiled cli.js
	const prod = join(import.meta.dir, "app");
	if (existsSync(join(prod, "index.html"))) return prod;

	// Development: running from src/ -> ../app/dist
	const dev = join(import.meta.dir, "../app/dist");
	if (existsSync(join(dev, "index.html"))) return dev;

	return null;
}
