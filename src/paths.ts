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

let appDistResolver: (() => string) | null = null;

/**
 * Standalone binaries carry the web UI as an embedded bundle, not a directory
 * on disk, so `import.meta.dir` (which is inside the binary's virtual
 * filesystem) can never find it. The compiled entrypoint registers a resolver
 * that unpacks the bundle instead. It stays lazy so `start --no-ui` — which
 * never asks for the path — pays nothing. Pass null to fall back to disk
 * lookup.
 */
export function setAppDistResolver(resolver: (() => string) | null): void {
	appDistResolver = resolver;
}

const VITE_CONFIGS = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"];

/**
 * A Vite project root ships an `index.html` too, but that one points at
 * `/src/main.tsx` — a path only the dev server can resolve, so serving it hands
 * the browser a module it cannot parse and a blank page. In a source checkout
 * `../app` is exactly that directory, sitting one level above the real build
 * output in `../app/dist`, so an `index.html` alone is not enough to identify
 * a servable UI: the Vite config next to it disqualifies the directory.
 */
function isBuiltUi(dir: string): boolean {
	if (!existsSync(join(dir, "index.html"))) return false;
	return !VITE_CONFIGS.some((config) => existsSync(join(dir, config)));
}

/**
 * Disk lookup behind `getAppDistPath`, taking the directory to resolve from so
 * the layouts below can be tested without moving the module.
 */
export function resolveAppDist(baseDir: string): string | null {
	// Production: app files are copied to dist/app/ alongside the compiled cli.js
	const prod = join(baseDir, "app");
	if (isBuiltUi(prod)) return prod;

	// Bundled: when bunup places shared modules in dist/shared/, resolve up one level
	const bundled = join(baseDir, "../app");
	if (isBuiltUi(bundled)) return bundled;

	// Development: running from src/ -> ../app/dist
	const dev = join(baseDir, "../app/dist");
	if (isBuiltUi(dev)) return dev;

	return null;
}

export function getAppDistPath(): string | null {
	if (appDistResolver) return appDistResolver();
	return resolveAppDist(import.meta.dir);
}
