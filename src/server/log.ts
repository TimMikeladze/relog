/**
 * Centralized server-side error logger. Every route catch block routes
 * through here so failures show up in operator logs with consistent
 * fields. Without this, route handlers silently return 4xx/5xx and ops
 * has no way to correlate a client report with a server-side cause.
 */
export function logRouteError(
	route: string,
	err: unknown,
	context?: { keyPrefix?: string; sql?: string; details?: Record<string, unknown> },
): void {
	const message = err instanceof Error ? err.message : String(err);
	const fields: Record<string, unknown> = { route };
	if (context?.keyPrefix) fields.keyPrefix = context.keyPrefix;
	if (context?.sql) fields.sql = context.sql.length > 500 ? `${context.sql.slice(0, 500)}…` : context.sql;
	if (context?.details) Object.assign(fields, context.details);
	fields.error = message;
	if (err instanceof Error && err.stack) fields.stack = err.stack.split("\n").slice(0, 5).join("\n");
	console.error(`[relog.dev] route_error ${JSON.stringify(fields)}`);
}
