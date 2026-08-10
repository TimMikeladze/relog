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

/**
 * The JSON side-stores (aggregates, widgets, dashboards) default to `~/.relog`
 * but accept an override so a server can be pointed at its own state
 * directory. Without this, two servers on one machine — or a test run —
 * silently share and overwrite each other's saved dashboards.
 */
function resolveStorePath(dataDir: string | undefined, filename: string): string {
	if (!dataDir) return join(getDataDir(), filename);
	mkdirSync(dataDir, { recursive: true });
	return join(dataDir, filename);
}

export function getAggregatesPath(dataDir?: string): string {
	return resolveStorePath(dataDir, "aggregates.json");
}

export function getWidgetsPath(dataDir?: string): string {
	return resolveStorePath(dataDir, "widgets.json");
}

export function getDashboardsPath(dataDir?: string): string {
	return resolveStorePath(dataDir, "dashboards.json");
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
