import { archiveLogs } from "../../archiver.ts";
import type { RelogDatabase } from "../../db/database.ts";
import type { DuckDBReader } from "../../db/duckdb.ts";
import type { ArchiveConfig, RetryConfig } from "../../types.ts";

const DEFAULT_RETRY: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 };

let archiveInFlight = false;

export async function handleArchive(
	request: Request,
	db: RelogDatabase,
	archiveConfig: ArchiveConfig | undefined,
	duckdb: DuckDBReader,
): Promise<Response> {
	if (!archiveConfig) {
		return Response.json(
			{ error: "Archive not configured. Provide --s3-* flags at server start." },
			{ status: 400 },
		);
	}

	if (archiveInFlight) {
		return Response.json({ error: "Archive already in progress" }, { status: 409 });
	}

	let body: { keepDays: number; retry?: Partial<RetryConfig> };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (typeof body.keepDays !== "number" || body.keepDays < 0) {
		return Response.json({ error: "keepDays must be a non-negative number" }, { status: 400 });
	}

	const beforeMs = Date.now() - body.keepDays * 86_400_000;
	const retry: RetryConfig = { ...DEFAULT_RETRY, ...body.retry };

	archiveInFlight = true;
	try {
		const result = await archiveLogs(db, archiveConfig, beforeMs, retry);
		// Refresh DuckDB view so newly archived Parquet files are visible
		await duckdb.refreshView();
		return Response.json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Archive failed";
		return Response.json({ error: message }, { status: 500 });
	} finally {
		archiveInFlight = false;
	}
}
