import type { DuckDBReader } from "../../db/duckdb.ts";
import { VALID_LEVELS } from "../../types.ts";

interface HistogramBody {
	from: number;
	to: number;
	buckets?: number;
	filters?: {
		level?: string;
		service?: string;
		project?: string;
		branch?: string;
	};
}

/** Compute adaptive bucket count based on time range */
function adaptiveBuckets(rangeMs: number): number {
	if (rangeMs <= 5 * 60_000) return 30; // <=5m: 10s buckets
	if (rangeMs <= 60 * 60_000) return 60; // <=1h: 1m buckets
	if (rangeMs <= 24 * 3600_000) return 144; // <=24h: 10m buckets
	if (rangeMs <= 7 * 86400_000) return 168; // <=7d: 1h buckets
	if (rangeMs <= 30 * 86400_000) return 180; // <=30d: 4h buckets
	return 360; // >30d: ~daily
}

export async function handleHistogram(request: Request, duckdb: DuckDBReader): Promise<Response> {
	let body: HistogramBody;
	try {
		body = (await request.json()) as HistogramBody;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (typeof body.from !== "number" || typeof body.to !== "number") {
		return Response.json({ error: "Missing or invalid 'from'/'to' (must be epoch ms)" }, { status: 400 });
	}

	if (body.to <= body.from) {
		return Response.json({ error: "'to' must be greater than 'from'" }, { status: 400 });
	}

	if (body.filters?.level && !VALID_LEVELS.has(body.filters.level)) {
		return Response.json({ error: `Invalid level '${body.filters.level}'` }, { status: 400 });
	}

	const rangeMs = body.to - body.from;
	const buckets = body.buckets ?? adaptiveBuckets(rangeMs);

	if (buckets < 1 || buckets > 1000) {
		return Response.json({ error: "Buckets must be between 1 and 1000" }, { status: 400 });
	}

	try {
		const result = await duckdb.histogram({
			from: body.from,
			to: body.to,
			buckets,
			filters: body.filters,
		});
		return Response.json(result);
	} catch {
		return Response.json({ error: "Histogram query failed" }, { status: 500 });
	}
}
