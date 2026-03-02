import type { RelogDatabase } from "../../db/database.ts";
import type { HealthResponse } from "../../types.ts";

export function handleHealth(
	db: RelogDatabase,
	startTime: number,
): Response {
	const response: HealthResponse = {
		ok: true,
		uptime: Math.round((Date.now() - startTime) / 1000),
		db_size_bytes: db.getDbSize(),
		log_count: db.getLogCount(),
	};
	return Response.json(response);
}
