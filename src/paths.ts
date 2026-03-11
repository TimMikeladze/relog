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

export function getAggregatesPath(): string {
	return join(getDataDir(), "aggregates.json");
}

export function getAppDistPath(): string | null {
	// Production: app files are copied to dist/app/ alongside the compiled cli.js
	const prod = join(import.meta.dir, "app");
	if (existsSync(join(prod, "index.html"))) return prod;

	// Bundled: when bunup places shared modules in dist/shared/, resolve up one level
	const bundled = join(import.meta.dir, "../app");
	if (existsSync(join(bundled, "index.html"))) return bundled;

	// Development: running from src/ -> ../app/dist
	const dev = join(import.meta.dir, "../app/dist");
	if (existsSync(join(dev, "index.html"))) return dev;

	return null;
}
