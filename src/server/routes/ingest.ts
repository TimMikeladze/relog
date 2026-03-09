import type { RelogDatabase } from "../../db/database.ts";
import { VALID_LEVELS } from "../../types.ts";
import type { IngestPayload } from "../../types.ts";

const MAX_MESSAGE_LENGTH = 1_048_576;
const MAX_STRING_FIELD_LENGTH = 1024;
const MAX_META_JSON_LENGTH = 1_048_576;

export async function handleIngest(
	request: Request,
	db: RelogDatabase,
	maxBatchSize: number = 1000,
	keyPrefix?: string,
): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const entries = Array.isArray(body) ? body : [body];

	if (entries.length === 0) {
		return Response.json({ error: "Empty payload" }, { status: 400 });
	}

	if (entries.length > maxBatchSize) {
		return Response.json(
			{ error: `Batch too large: ${entries.length} entries exceeds max of ${maxBatchSize}` },
			{ status: 400 },
		);
	}

	for (const entry of entries) {
		if (
			typeof entry !== "object" ||
			entry === null ||
			typeof entry.message !== "string" ||
			!VALID_LEVELS.has(entry.level)
		) {
			return Response.json(
				{ error: "Invalid log entry: requires valid level and string message" },
				{ status: 400 },
			);
		}
		if (entry.service !== undefined && typeof entry.service !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'service' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.timestamp !== undefined && typeof entry.timestamp !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'timestamp' must be a string" },
				{ status: 400 },
			);
		}
		if (
			entry.meta !== undefined &&
			(typeof entry.meta !== "object" || entry.meta === null || Array.isArray(entry.meta))
		) {
			return Response.json(
				{ error: "Invalid log entry: 'meta' must be a plain object" },
				{ status: 400 },
			);
		}
		if (entry.pid !== undefined && typeof entry.pid !== "number") {
			return Response.json({ error: "Invalid log entry: 'pid' must be a number" }, { status: 400 });
		}
		if (entry.host !== undefined && typeof entry.host !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'host' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.trace_id !== undefined && typeof entry.trace_id !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'trace_id' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.span_id !== undefined && typeof entry.span_id !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'span_id' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.project !== undefined && typeof entry.project !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'project' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.branch !== undefined && typeof entry.branch !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'branch' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.version !== undefined && typeof entry.version !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'version' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.deployment_id !== undefined && typeof entry.deployment_id !== "string") {
			return Response.json(
				{ error: "Invalid log entry: 'deployment_id' must be a string" },
				{ status: 400 },
			);
		}
		if (entry.message.length > MAX_MESSAGE_LENGTH) {
			return Response.json(
				{ error: `Invalid log entry: 'message' exceeds ${MAX_MESSAGE_LENGTH} characters` },
				{ status: 400 },
			);
		}
		for (const field of [
			"service",
			"host",
			"trace_id",
			"span_id",
			"project",
			"branch",
			"version",
			"deployment_id",
		] as const) {
			if (typeof entry[field] === "string" && entry[field].length > MAX_STRING_FIELD_LENGTH) {
				return Response.json(
					{ error: `Invalid log entry: '${field}' exceeds ${MAX_STRING_FIELD_LENGTH} characters` },
					{ status: 400 },
				);
			}
		}
		if (entry.meta !== undefined) {
			const metaJson = JSON.stringify(entry.meta);
			if (metaJson.length > MAX_META_JSON_LENGTH) {
				return Response.json(
					{ error: `Invalid log entry: 'meta' exceeds ${MAX_META_JSON_LENGTH} bytes` },
					{ status: 400 },
				);
			}
		}
	}

	db.insert(entries as IngestPayload[], keyPrefix);
	return Response.json({ ingested: entries.length }, { status: 201 });
}
