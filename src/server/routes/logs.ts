import type { RelogDatabase, SearchOptions } from "../../db/database.ts";
import { VALID_LEVELS } from "../../types.ts";

export function handleLogs(
	request: Request,
	db: RelogDatabase,
): Response {
	const url = new URL(request.url);
	const opts: SearchOptions = {};

	const level = url.searchParams.get("level");
	if (level) {
		if (!VALID_LEVELS.has(level)) {
			return Response.json(
				{ error: `Invalid level '${level}'` },
				{ status: 400 },
			);
		}
		opts.level = level;
	}
	const service = url.searchParams.get("service");
	if (service) opts.service = service;
	const project = url.searchParams.get("project");
	if (project) opts.project = project;
	const branch = url.searchParams.get("branch");
	if (branch) opts.branch = branch;
	const grep = url.searchParams.get("grep");
	if (grep) opts.grep = grep;

	const from = url.searchParams.get("from");
	if (from) {
		const parsed = parseTime(from);
		if (Number.isNaN(parsed)) {
			return Response.json(
				{ error: "Invalid 'from' time format" },
				{ status: 400 },
			);
		}
		opts.from = parsed;
	}

	const to = url.searchParams.get("to");
	if (to) {
		const parsed = parseTime(to);
		if (Number.isNaN(parsed)) {
			return Response.json(
				{ error: "Invalid 'to' time format" },
				{ status: 400 },
			);
		}
		opts.to = parsed;
	}

	const limit = url.searchParams.get("limit");
	if (limit) {
		const parsed = Number.parseInt(limit, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			return Response.json(
				{ error: "Invalid 'limit' value" },
				{ status: 400 },
			);
		}
		opts.limit = Math.min(parsed, 10000);
	}
	const offset = url.searchParams.get("offset");
	if (offset) {
		const parsed = Number.parseInt(offset, 10);
		if (Number.isNaN(parsed) || parsed < 0) {
			return Response.json(
				{ error: "Invalid 'offset' value" },
				{ status: 400 },
			);
		}
		opts.offset = parsed;
	}

	const result = db.searchLogs(opts);

	return Response.json({
		rows: result.rows,
		total: result.total,
		limit: opts.limit ?? 100,
		offset: opts.offset ?? 0,
	});
}

function parseTime(input: string): number {
	const relative = input.match(/^(\d+)([smhd])$/);
	if (relative) {
		const value = Number.parseInt(relative[1]!, 10);
		const unit = relative[2]!;
		const multipliers: Record<string, number> = {
			s: 1000,
			m: 60_000,
			h: 3_600_000,
			d: 86_400_000,
		};
		return Date.now() - value * multipliers[unit]!;
	}
	return new Date(input).getTime();
}
