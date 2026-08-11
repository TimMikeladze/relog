import type { Filters, LogLevel } from "@/types";

/** Severity order, lowest first. Mirrors `VALID_LEVELS` on the server. */
export const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

/**
 * The one place a log level is turned into a colour. Rows, badges, chart
 * series, and facet menus all read from here so `info` can't be emerald in
 * the sidebar and cyan in the badge at the same time.
 */
export const LEVEL_VAR: Record<string, string> = {
	trace: "var(--level-trace)",
	debug: "var(--level-debug)",
	info: "var(--level-info)",
	warn: "var(--level-warn)",
	error: "var(--level-error)",
	fatal: "var(--level-fatal)",
};

export function levelColor(level: string): string {
	return LEVEL_VAR[level] ?? "var(--level-trace)";
}

const UNIT_MS: Record<string, number> = {
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
	M: 2_592_000_000,
	y: 31_536_000_000,
};

const RELATIVE_RE = /^(\d+)([smhdwMy])$/;

export function isRelativeTime(v?: string): v is string {
	return !!v && RELATIVE_RE.test(v);
}

/** Milliseconds covered by a relative range like `15m`, or null if unparseable. */
export function relativeToMs(rel: string): number | null {
	const match = rel.match(RELATIVE_RE);
	if (!match) return null;
	return Number.parseInt(match[1]!, 10) * (UNIT_MS[match[2]!] ?? UNIT_MS.h!);
}

/**
 * Resolve a filter pair to absolute epoch ms. Matches `parseTime` on the
 * server: a relative `from` means "that long ago until now".
 */
export function resolveRange(filters: Pick<Filters, "from" | "to">): {
	fromMs: number | null;
	toMs: number | null;
} {
	const { from, to } = filters;
	let fromMs: number | null = null;
	if (from) {
		const rel = relativeToMs(from);
		fromMs = rel !== null ? Date.now() - rel : toFiniteTime(from);
	}
	const toMs = to ? toFiniteTime(to) : null;
	return { fromMs, toMs };
}

function toFiniteTime(input: string): number | null {
	const ms = new Date(input).getTime();
	return Number.isFinite(ms) ? ms : null;
}

export const TIME_PRESETS: { label: string; value: string; group: string }[] = [
	{ label: "5 min", value: "5m", group: "Minutes" },
	{ label: "15 min", value: "15m", group: "Minutes" },
	{ label: "30 min", value: "30m", group: "Minutes" },
	{ label: "1 hour", value: "1h", group: "Hours" },
	{ label: "3 hours", value: "3h", group: "Hours" },
	{ label: "6 hours", value: "6h", group: "Hours" },
	{ label: "12 hours", value: "12h", group: "Hours" },
	{ label: "24 hours", value: "24h", group: "Hours" },
	{ label: "3 days", value: "3d", group: "Days" },
	{ label: "7 days", value: "7d", group: "Days" },
	{ label: "14 days", value: "14d", group: "Days" },
	{ label: "30 days", value: "30d", group: "Days" },
	{ label: "90 days", value: "90d", group: "Days" },
	{ label: "6 months", value: "6M", group: "Days" },
	{ label: "1 year", value: "1y", group: "Days" },
];

export const TIME_PRESET_GROUPS = ["Minutes", "Hours", "Days"] as const;

function formatAbsolute(iso: string, withYear: boolean): string {
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) return iso;
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		...(withYear ? { year: "numeric" } : {}),
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

/**
 * Human label for the current range, used as the time picker's trigger text.
 * "Last 1 hour" tells you more at a glance than one highlighted pill in a
 * grid of fifteen.
 */
export function describeRange(filters: Pick<Filters, "from" | "to">): string {
	const { from, to } = filters;
	if (!from && !to) return "All time";
	if (isRelativeTime(from) && !to) {
		const preset = TIME_PRESETS.find((p) => p.value === from);
		return `Last ${preset ? preset.label : from}`;
	}
	const thisYear = new Date().getFullYear();
	const spansYears = [from, to].some(
		(v) => v && !isRelativeTime(v) && new Date(v).getFullYear() !== thisYear,
	);
	const left = from ? (isRelativeTime(from) ? from : formatAbsolute(from, spansYears)) : "Earliest";
	const right = to ? formatAbsolute(to, spansYears) : "Now";
	return `${left} – ${right}`;
}

/** Mirrors the server's `escapeLike` so `%` and `_` stay literal in a search. */
function escapeLike(value: string): string {
	return value.replace(/[%_\\]/g, "\\$&");
}

/** Comma-joined multi-select values, empty entries dropped. */
export function splitValues(value?: string): string[] {
	return value?.split(",").filter(Boolean) ?? [];
}

export function toggleValue(current: string | undefined, value: string): string | undefined {
	const set = new Set(splitValues(current));
	if (set.has(value)) set.delete(value);
	else set.add(value);
	return set.size > 0 ? Array.from(set).join(",") : undefined;
}

/** Filter keys that map to an `IN (...)` predicate on a column of the same name. */
export const FACET_KEYS = [
	"level",
	"service",
	"project",
	"branch",
	"version",
	"deployment_id",
] as const;

export type FacetKey = (typeof FACET_KEYS)[number];

export interface WhereClause {
	/** `WHERE ...`, or empty string when nothing is filtered. */
	sql: string;
	/** Positional bindings for the `?` placeholders, in order. */
	params: (string | number)[];
}

/**
 * Build a parameterised WHERE clause from the active filters.
 *
 * `exclude` drops one dimension so a facet's own selection doesn't constrain
 * its own counts — otherwise picking `service=worker` would make every other
 * service report zero and there'd be no way to see what you're missing. Every
 * *other* active filter still applies, so the counts describe the set you are
 * actually looking at.
 *
 * Values are bound, never interpolated: a service named `it's-fine` used to
 * produce a syntax error rather than a filter.
 */
export function buildWhere(filters: Filters, exclude?: FacetKey): WhereClause {
	const clauses: string[] = [];
	const params: (string | number)[] = [];
	const { fromMs, toMs } = resolveRange(filters);

	if (fromMs !== null) {
		clauses.push("created_at >= ?");
		params.push(fromMs);
	}
	if (toMs !== null) {
		clauses.push("created_at <= ?");
		params.push(toMs);
	}

	for (const key of FACET_KEYS) {
		if (key === exclude) continue;
		const values = splitValues(filters[key]);
		if (values.length === 0) continue;
		clauses.push(`${key} IN (${values.map(() => "?").join(", ")})`);
		params.push(...values);
	}

	if (filters.trace_id) {
		clauses.push("trace_id = ?");
		params.push(filters.trace_id);
	}
	if (filters.grep) {
		// `message`-only, matching the server's `search`/`histogram` predicate.
		// Searching meta here too would make facet counts exceed the number of
		// rows the same filters actually return.
		clauses.push("message LIKE ? ESCAPE '\\'");
		params.push(`%${escapeLike(filters.grep)}%`);
	}

	return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/** Filter keys that count as "narrowing the result set" for the empty state. */
const NARROWING_KEYS: (keyof Filters)[] = [
	...FACET_KEYS,
	"grep",
	"trace_id",
	"bookmarked",
	"from",
	"to",
];

export function activeFilterCount(filters: Filters): number {
	return NARROWING_KEYS.filter((k) => filters[k]).length;
}
