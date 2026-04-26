import type { SearchOptions } from "../../db/database.ts";
import type { DuckDBReader } from "../../db/duckdb.ts";
import { VALID_LEVELS } from "../../types.ts";
import { logRouteError } from "../log.ts";

export async function handleLogs(
	request: Request,
	duckdb: DuckDBReader,
	keyPrefix?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const opts: SearchOptions = {};

	const level = url.searchParams.get("level");
	if (level) {
		const levels = level.split(",");
		if (levels.some((l) => !VALID_LEVELS.has(l))) {
			return Response.json({ error: `Invalid level '${level}'` }, { status: 400 });
		}
		opts.level = level;
	}
	const service = url.searchParams.get("service");
	if (service) opts.service = service;
	const project = url.searchParams.get("project");
	if (project) opts.project = project;
	const branch = url.searchParams.get("branch");
	if (branch) opts.branch = branch;
	const version = url.searchParams.get("version");
	if (version) opts.version = version;
	const deploymentId = url.searchParams.get("deployment_id");
	if (deploymentId) opts.deployment_id = deploymentId;
	const traceId = url.searchParams.get("trace_id");
	if (traceId) opts.trace_id = traceId;
	const spanId = url.searchParams.get("span_id");
	if (spanId) opts.span_id = spanId;
	const grep = url.searchParams.get("grep");
	if (grep) opts.grep = grep;

	const from = url.searchParams.get("from");
	if (from) {
		const parsed = parseTime(from);
		if (Number.isNaN(parsed)) {
			return Response.json({ error: "Invalid 'from' time format" }, { status: 400 });
		}
		opts.from = parsed;
	}

	const to = url.searchParams.get("to");
	if (to) {
		const parsed = parseTime(to);
		if (Number.isNaN(parsed)) {
			return Response.json({ error: "Invalid 'to' time format" }, { status: 400 });
		}
		opts.to = parsed;
	}

	const limit = url.searchParams.get("limit");
	if (limit) {
		const parsed = Number.parseInt(limit, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			return Response.json({ error: "Invalid 'limit' value" }, { status: 400 });
		}
		opts.limit = Math.min(parsed, 10000);
	}
	const offset = url.searchParams.get("offset");
	if (offset) {
		const parsed = Number.parseInt(offset, 10);
		if (Number.isNaN(parsed) || parsed < 0) {
			return Response.json({ error: "Invalid 'offset' value" }, { status: 400 });
		}
		opts.offset = parsed;
	}

	const aroundId = url.searchParams.get("around_id");
	if (aroundId) {
		const parsed = Number.parseInt(aroundId, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			return Response.json({ error: "Invalid 'around_id' value" }, { status: 400 });
		}
		opts.around_id = parsed;
	}

	try {
		const result = await duckdb.searchLogs(opts);
		return Response.json({
			rows: result.rows,
			total: result.total,
			limit: opts.limit ?? 100,
			offset: opts.offset ?? 0,
		});
	} catch (err) {
		logRouteError("GET /logs", err, { keyPrefix, details: { ...opts } as Record<string, unknown> });
		return Response.json({ error: "Logs query failed" }, { status: 500 });
	}
}

function parseTime(input: string): number {
	const relative = input.match(/^(\d+)([smhdwMy])$/);
	if (relative) {
		const value = Number.parseInt(relative[1]!, 10);
		const unit = relative[2]!;
		const multipliers: Record<string, number> = {
			s: 1000,
			m: 60_000,
			h: 3_600_000,
			d: 86_400_000,
			w: 604_800_000,
			M: 2_592_000_000,
			y: 31_536_000_000,
		};
		return Date.now() - value * multipliers[unit]!;
	}
	return new Date(input).getTime();
}
