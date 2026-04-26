import type { RelogDatabase } from "../../db/database.ts";
import { logRouteError } from "../log.ts";

export async function handlePrune(
	request: Request,
	db: RelogDatabase,
	keyPrefix?: string,
): Promise<Response> {
	let body: { before: number };
	try {
		body = (await request.json()) as { before: number };
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (typeof body.before !== "number") {
		return Response.json({ error: "Missing 'before' field (unix millis)" }, { status: 400 });
	}

	try {
		const deleted = db.prune(body.before);
		return Response.json({ deleted });
	} catch (err) {
		logRouteError("POST /prune", err, { keyPrefix, details: { before: body.before } });
		return Response.json({ error: "Prune failed" }, { status: 500 });
	}
}
