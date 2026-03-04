import type { RelogDatabase } from "../../db/database.ts";
import type { AutoPruneConfig, HealthResponse } from "../../types.ts";

export function handleHealth(
	db: RelogDatabase,
	startTime: number,
	autoPrune?: AutoPruneConfig,
): Response {
	const dbSize = db.getDbSize();
	const response: HealthResponse = {
		ok: true,
		uptime: Math.round((Date.now() - startTime) / 1000),
		db_size_bytes: dbSize,
		log_count: db.getLogCount(),
	};
	if (autoPrune) {
		response.auto_prune = {
			max_db_size: autoPrune.maxDbSize,
			max_age_days: autoPrune.maxAgeDays,
			interval_seconds: autoPrune.intervalSeconds ?? 60,
			db_usage_pct: autoPrune.maxDbSize
				? Math.round((dbSize / autoPrune.maxDbSize) * 100)
				: undefined,
		};
	}
	return Response.json(response);
}
