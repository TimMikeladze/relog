import { readFileSync } from "node:fs";
import type { SourceConfig } from "./types.ts";

const MIN_EVERY_SECONDS = 10;

/**
 * Resolve $ENV_VAR references in string values.
 * Throws if a referenced env var is not set.
 */
function resolveEnvVars(value: unknown): unknown {
	if (typeof value === "string" && value.startsWith("$")) {
		const envName = value.slice(1);
		const envValue = process.env[envName];
		if (!envValue) {
			throw new Error(`Environment variable ${envName} is not set (referenced as ${value})`);
		}
		return envValue;
	}
	if (Array.isArray(value)) {
		return value.map(resolveEnvVars);
	}
	if (typeof value === "object" && value !== null) {
		const resolved: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			resolved[k] = resolveEnvVars(v);
		}
		return resolved;
	}
	return value;
}

/**
 * Strip comments from a YAML line, respecting quoted strings.
 * A `#` inside single or double quotes is NOT treated as a comment.
 */
function stripComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === "#" && !inSingle && !inDouble) {
			return line.slice(0, i);
		}
	}
	return line;
}

/**
 * Minimal YAML-subset parser for sources config.
 * Supports: top-level `sources:` array of objects with string/number values.
 * Handles hyphenated keys, dotted keys, and `#` in quoted values.
 */
function parseSimpleYaml(text: string): { sources: Record<string, unknown>[] } {
	const lines = text.split("\n");
	const sources: Record<string, unknown>[] = [];
	let current: Record<string, unknown> | null = null;

	for (const raw of lines) {
		const line = stripComment(raw);
		if (!line.trim()) continue;

		// Top-level key (sources:)
		if (/^sources:\s*$/.test(line)) continue;

		// Array item start (e.g. "  - adapter: github-actions")
		const arrayMatch = line.match(/^\s+-\s+([\w.-]+):\s*(.+)$/);
		if (arrayMatch) {
			current = { [arrayMatch[1]!]: parseValue(arrayMatch[2]!) };
			sources.push(current);
			continue;
		}

		// Continuation of current object (e.g. "    repo: myorg/app")
		const kvMatch = line.match(/^\s+([\w.-]+):\s*(.+)$/);
		if (kvMatch && current) {
			current[kvMatch[1]!] = parseValue(kvMatch[2]!);
		}
	}

	return { sources };
}

function parseValue(raw: string): string | number | boolean {
	const trimmed = raw.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	const num = Number(trimmed);
	if (!Number.isNaN(num) && trimmed !== "") return num;
	// Strip quotes if present
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Derive a stable source ID from config.
 * Uses explicit `id` if set, otherwise builds from adapter + non-secret config keys.
 */
export function deriveSourceId(config: SourceConfig): string {
	if (typeof config.id === "string") return config.id;

	const exclude = new Set(["adapter", "every", "id"]);
	const secretPattern = /token|key|secret|password|credential/i;

	const keys = Object.keys(config)
		.filter((k) => !exclude.has(k) && !secretPattern.test(k))
		.sort();

	if (keys.length === 0) return config.adapter;

	const parts = keys.map((k) => `${k}=${config[k]}`);
	return `${config.adapter}:${parts.join(",")}`;
}

export function loadSourcesConfig(filePath: string): SourceConfig[] {
	const text = readFileSync(filePath, "utf-8");
	const parsed = parseSimpleYaml(text);

	if (!parsed.sources || !Array.isArray(parsed.sources)) {
		throw new Error(`Invalid sources config: expected 'sources' array in ${filePath}`);
	}

	const configs: SourceConfig[] = [];
	const seenIds = new Set<string>();

	for (const raw of parsed.sources) {
		const resolved = resolveEnvVars(raw) as Record<string, unknown>;

		if (typeof resolved.adapter !== "string") {
			throw new Error("Each source must have an 'adapter' string");
		}
		if (typeof resolved.every !== "number" || resolved.every <= 0) {
			throw new Error("Each source must have a positive 'every' (seconds)");
		}

		// Enforce minimum poll interval
		if (resolved.every < MIN_EVERY_SECONDS) {
			console.warn(
				`[relog.dev] source 'every' clamped to ${MIN_EVERY_SECONDS}s (was ${resolved.every}s)`,
			);
			resolved.every = MIN_EVERY_SECONDS;
		}

		const config = resolved as unknown as SourceConfig;
		const id = deriveSourceId(config);

		if (seenIds.has(id)) {
			throw new Error(`Duplicate source id "${id}". Add an explicit 'id' field to disambiguate.`);
		}
		seenIds.add(id);

		configs.push(config);
	}

	return configs;
}
