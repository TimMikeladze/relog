import type { DashboardVariable } from "@/types";

/**
 * Values available to a widget's SQL as `${name}` placeholders.
 *
 * `from` and `to` are always present — they come from the time-range picker,
 * which every dashboard has. Everything else is whatever the dashboard
 * declared, which is what lets a dashboard over analytics filter by `site`
 * while one over logs filters by `service` without either being special-cased
 * here.
 */
export interface SqlVars {
	from: number;
	to: number;
	[name: string]: string | number | null | undefined;
}

/** Supplied by the runtime rather than declared, and always numeric. */
export const BUILTIN_VARS = ["from", "to"] as const;

const PLACEHOLDER = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function quote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Everything reaching SQL goes through here, so the rule is: a value is
 * either a bare number we produced ourselves, or a single-quoted string with
 * embedded quotes doubled. There is no path by which a user-entered variable
 * value becomes SQL syntax.
 */
function literal(
	value: string | number | null | undefined,
	type?: DashboardVariable["type"],
): string {
	if (value === null || value === undefined || value === "") return "NULL";
	if (type === "number") {
		const n = typeof value === "number" ? value : Number(value);
		// A non-numeric value in a numeric variable becomes NULL rather than
		// being quoted — the widget's `(${v} IS NULL OR col = ${v})` idiom then
		// reads as "unset", which is the sane reading of a malformed number.
		return Number.isFinite(n) ? String(n) : "NULL";
	}
	return quote(String(value));
}

export interface SubstituteOptions {
	/** Declarations for the dashboard's variables, used for typing and validation. */
	variables?: DashboardVariable[];
	/**
	 * Accept placeholders with no matching declaration by substituting NULL.
	 * Used by the widget editor's live preview, where the SQL is being typed
	 * against variables the user may not have declared yet, and throwing on
	 * every keystroke would make the editor unusable.
	 */
	lenient?: boolean;
}

export function substituteVars(
	sql: string,
	vars: SqlVars,
	options: SubstituteOptions = {},
): string {
	const declared = new Map((options.variables ?? []).map((v) => [v.name, v]));

	return sql.replace(PLACEHOLDER, (_match, name: string) => {
		if (name === "from" || name === "to") {
			return String(Math.floor(vars[name] as number));
		}
		const declaration = declared.get(name);
		if (!declaration) {
			// Silence here would be worse than an error: the widget would run
			// with a silently-dropped filter and show numbers for the wrong
			// scope, which nobody would notice.
			if (options.lenient) return "NULL";
			throw new Error(`Unknown placeholder: ${name}`);
		}
		return literal(vars[name], declaration.type);
	});
}

/** Placeholder names a piece of SQL references, in first-appearance order. */
export function extractPlaceholders(sql: string): string[] {
	const seen = new Set<string>();
	for (const match of sql.matchAll(PLACEHOLDER)) {
		seen.add(match[1]!);
	}
	return [...seen];
}

/**
 * Placeholders the given dashboard cannot satisfy. Surfaced in the widget
 * editor so a typo is caught while writing the widget rather than as a broken
 * tile later.
 */
export function undeclaredPlaceholders(sql: string, variables: DashboardVariable[]): string[] {
	const known = new Set<string>([...BUILTIN_VARS, ...variables.map((v) => v.name)]);
	return extractPlaceholders(sql).filter((p) => !known.has(p));
}

/** Initial values for a dashboard's variables, from their declared defaults. */
export function defaultVarValues(variables: DashboardVariable[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const v of variables) {
		out[v.name] = v.default == null ? "" : String(v.default);
	}
	return out;
}
