/**
 * Redacts likely-secret values out of ingest meta. Logs are commonly
 * scraped from request/response handlers and meta often contains raw
 * Authorization headers, cookies, or API tokens by accident. We redact
 * by key name (case-insensitive substring match) so this catches the
 * common shapes — `authorization`, `cookie`, `x-api-key`, `password`,
 * `secret`, `token` — without trying to scan values for entropy.
 *
 * Recursion depth is bounded so a hostile or pathological meta object
 * cannot blow the stack on ingest.
 */
const SENSITIVE_KEY_PATTERN =
	/(authorization|^auth$|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|session[_-]?id|client[_-]?secret|bearer)/i;
const REDACTION = "[REDACTED]";
const MAX_DEPTH = 12;

export function redactMeta(value: unknown): unknown {
	return redactInner(value, 0);
}

function redactInner(value: unknown, depth: number): unknown {
	// At depth limit, replace the entire subtree with a marker rather than
	// returning the raw value untouched. Otherwise a hostile or accidental
	// deeply-nested object could carry an unredacted secret past the depth
	// guard: e.g. `{a:{a:{...12 levels...{authorization: "..."}}}}` would
	// have its inner `authorization` key skipped because recursion stopped.
	if (depth > MAX_DEPTH) {
		if (value !== null && typeof value === "object") return "[TRUNCATED]";
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((v) => redactInner(v, depth + 1));
	}
	if (value === null || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (SENSITIVE_KEY_PATTERN.test(k)) {
			out[k] = REDACTION;
		} else {
			out[k] = redactInner(v, depth + 1);
		}
	}
	return out;
}
