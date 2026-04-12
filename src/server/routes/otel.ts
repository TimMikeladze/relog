import type { RelogDatabase } from "../../db/database.ts";
import type { IngestPayload, LogLevel } from "../../types.ts";

const MAX_MESSAGE_LENGTH = 1_048_576;
const MAX_STRING_FIELD_LENGTH = 1024;
const MAX_META_JSON_LENGTH = 1_048_576;

// ── OTLP/JSON types ────────────────────────────────────────────────

interface OtelAnyValue {
	stringValue?: string;
	intValue?: string;
	doubleValue?: number;
	boolValue?: boolean;
	arrayValue?: { values: OtelAnyValue[] };
	kvlistValue?: { values: OtelKeyValue[] };
	bytesValue?: string;
}

interface OtelKeyValue {
	key: string;
	value: OtelAnyValue;
}

interface OtelResource {
	attributes?: OtelKeyValue[];
}

interface OtelSpanEvent {
	timeUnixNano?: string;
	name: string;
	attributes?: OtelKeyValue[];
}

interface OtelSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind?: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes?: OtelKeyValue[];
	events?: OtelSpanEvent[];
	status?: { code?: number; message?: string };
}

interface OtelScopeSpans {
	scope?: { name?: string; version?: string };
	spans?: OtelSpan[];
}

interface OtelResourceSpans {
	resource?: OtelResource;
	scopeSpans?: OtelScopeSpans[];
}

interface OtelTracesPayload {
	resourceSpans?: OtelResourceSpans[];
}

interface OtelLogRecord {
	timeUnixNano?: string;
	observedTimeUnixNano?: string;
	severityNumber?: number;
	severityText?: string;
	body?: OtelAnyValue;
	attributes?: OtelKeyValue[];
	traceId?: string;
	spanId?: string;
}

interface OtelScopeLogs {
	scope?: { name?: string; version?: string };
	logRecords?: OtelLogRecord[];
}

interface OtelResourceLogs {
	resource?: OtelResource;
	scopeLogs?: OtelScopeLogs[];
}

interface OtelLogsPayload {
	resourceLogs?: OtelResourceLogs[];
}

// ── Helpers ────────────────────────────────────────────────────────

const SPAN_KINDS: Record<number, string> = {
	0: "unspecified",
	1: "internal",
	2: "server",
	3: "client",
	4: "producer",
	5: "consumer",
};

const MAX_ATTR_DEPTH = 10;

function extractValue(val: OtelAnyValue, depth = 0): unknown {
	if (!val || depth > MAX_ATTR_DEPTH) return undefined;
	if (val.stringValue !== undefined) return val.stringValue;
	if (val.intValue !== undefined) {
		const n = Number(val.intValue);
		return Number.isSafeInteger(n) ? n : val.intValue;
	}
	if (val.doubleValue !== undefined) return val.doubleValue;
	if (val.boolValue !== undefined) return val.boolValue;
	if (val.arrayValue) return val.arrayValue.values.map((v) => extractValue(v, depth + 1));
	if (val.kvlistValue) {
		const obj: Record<string, unknown> = {};
		for (const kv of val.kvlistValue.values) {
			obj[kv.key] = extractValue(kv.value, depth + 1);
		}
		return obj;
	}
	if (val.bytesValue !== undefined) return val.bytesValue;
	return undefined;
}

function flattenAttributes(attrs?: OtelKeyValue[]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (!attrs) return result;
	for (const kv of attrs) {
		result[kv.key] = extractValue(kv.value, 0);
	}
	return result;
}

function getResourceString(attrs: Record<string, unknown>, key: string): string | undefined {
	const val = attrs[key];
	return typeof val === "string" ? val : undefined;
}

function nanoToMs(nanos: string): number {
	try {
		return Number(BigInt(nanos) / 1_000_000n);
	} catch {
		return Date.now();
	}
}

function nanoToIso(nanos: string): string {
	const ms = nanoToMs(nanos);
	return new Date(ms).toISOString();
}

function severityToLevel(severityNumber?: number): LogLevel {
	if (!severityNumber || severityNumber <= 0) return "info";
	if (severityNumber <= 4) return "trace";
	if (severityNumber <= 8) return "debug";
	if (severityNumber <= 12) return "info";
	if (severityNumber <= 16) return "warn";
	if (severityNumber <= 20) return "error";
	return "fatal";
}

function bodyToString(body?: OtelAnyValue): string {
	if (!body) return "";
	if (body.stringValue !== undefined) return body.stringValue;
	const val = extractValue(body);
	return typeof val === "string" ? val : JSON.stringify(val);
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) : s;
}

function validateEntry(entry: IngestPayload): IngestPayload {
	return {
		...entry,
		message: truncate(entry.message || "span", MAX_MESSAGE_LENGTH),
		service: entry.service ? truncate(entry.service, MAX_STRING_FIELD_LENGTH) : undefined,
		host: entry.host ? truncate(entry.host, MAX_STRING_FIELD_LENGTH) : undefined,
		trace_id: entry.trace_id ? truncate(entry.trace_id, MAX_STRING_FIELD_LENGTH) : undefined,
		span_id: entry.span_id ? truncate(entry.span_id, MAX_STRING_FIELD_LENGTH) : undefined,
		parent_span_id: entry.parent_span_id
			? truncate(entry.parent_span_id, MAX_STRING_FIELD_LENGTH)
			: undefined,
		meta: entry.meta
			? (() => {
					const json = JSON.stringify(entry.meta);
					return json.length > MAX_META_JSON_LENGTH ? { _truncated: true } : entry.meta;
				})()
			: undefined,
	};
}

// ── Traces handler ─────────────────────────────────────────────────

export async function handleOtelTraces(
	request: Request,
	db: RelogDatabase,
	maxBatchSize: number,
	keyPrefix?: string,
): Promise<Response> {
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("protobuf")) {
		return Response.json(
			{ error: "OTLP/Proto not supported, use OTLP/JSON (application/json)" },
			{ status: 415 },
		);
	}

	let payload: OtelTracesPayload;
	try {
		payload = (await request.json()) as OtelTracesPayload;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!payload.resourceSpans || !Array.isArray(payload.resourceSpans)) {
		return Response.json({ error: "Missing resourceSpans" }, { status: 400 });
	}

	const entries: IngestPayload[] = [];

	for (const rs of payload.resourceSpans) {
		const resourceAttrs = flattenAttributes(rs.resource?.attributes);
		const serviceName = getResourceString(resourceAttrs, "service.name");
		const hostName = getResourceString(resourceAttrs, "host.name");

		for (const ss of rs.scopeSpans ?? []) {
			for (const span of ss.spans ?? []) {
				// Skip spans with empty identifiers
				if (!span.traceId || !span.spanId) continue;

				const spanAttrs = flattenAttributes(span.attributes);
				const startMs = nanoToMs(span.startTimeUnixNano);
				const endMs = nanoToMs(span.endTimeUnixNano);
				const durationMs = Math.round((endMs - startMs) * 100) / 100;

				const isError = span.status?.code === 2;
				const level: LogLevel = isError ? "error" : "info";

				const meta: Record<string, unknown> = {
					...spanAttrs,
					otel: true,
					span_kind: SPAN_KINDS[span.kind ?? 0] ?? "unspecified",
				};
				if (span.status?.code !== undefined) {
					meta.span_status_code = span.status.code;
				}
				if (span.status?.message) {
					meta.span_status_message = span.status.message;
				}
				if (ss.scope?.name) {
					meta.instrumentation_scope = ss.scope.name;
				}
				if (Object.keys(resourceAttrs).length > 0) {
					meta.resource = resourceAttrs;
				}

				entries.push(
					validateEntry({
						timestamp: nanoToIso(span.startTimeUnixNano),
						level,
						message: span.name,
						meta,
						service: serviceName,
						host: hostName,
						trace_id: span.traceId,
						span_id: span.spanId,
						parent_span_id: span.parentSpanId || undefined,
						duration_ms: durationMs,
					}),
				);

				// Convert span events into separate log entries
				if (span.events) {
					for (const event of span.events) {
						const eventAttrs = flattenAttributes(event.attributes);
						const isException = event.name === "exception";
						const eventLevel: LogLevel = isException ? "error" : level;

						let eventMessage = event.name;
						if (isException && eventAttrs["exception.message"]) {
							eventMessage = `${event.name}: ${eventAttrs["exception.message"]}`;
						}

						entries.push(
							validateEntry({
								timestamp: event.timeUnixNano
									? nanoToIso(event.timeUnixNano)
									: nanoToIso(span.startTimeUnixNano),
								level: eventLevel,
								message: eventMessage,
								meta: { ...eventAttrs, otel: true, otel_event: true },
								service: serviceName,
								host: hostName,
								trace_id: span.traceId,
								span_id: span.spanId,
							}),
						);
					}
				}
			}
		}
	}

	// OTLP spec: empty-but-valid payloads return 200
	if (entries.length === 0) {
		return Response.json({ partialSuccess: {} }, { status: 200 });
	}

	if (entries.length > maxBatchSize) {
		return Response.json(
			{ error: `Batch too large: ${entries.length} entries exceeds max of ${maxBatchSize}` },
			{ status: 400 },
		);
	}

	db.insert(entries, keyPrefix);
	return Response.json({ partialSuccess: {} }, { status: 200 });
}

// ── Logs handler ───────────────────────────────────────────────────

export async function handleOtelLogs(
	request: Request,
	db: RelogDatabase,
	maxBatchSize: number,
	keyPrefix?: string,
): Promise<Response> {
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("protobuf")) {
		return Response.json(
			{ error: "OTLP/Proto not supported, use OTLP/JSON (application/json)" },
			{ status: 415 },
		);
	}

	let payload: OtelLogsPayload;
	try {
		payload = (await request.json()) as OtelLogsPayload;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!payload.resourceLogs || !Array.isArray(payload.resourceLogs)) {
		return Response.json({ error: "Missing resourceLogs" }, { status: 400 });
	}

	const entries: IngestPayload[] = [];

	for (const rl of payload.resourceLogs) {
		const resourceAttrs = flattenAttributes(rl.resource?.attributes);
		const serviceName = getResourceString(resourceAttrs, "service.name");
		const hostName = getResourceString(resourceAttrs, "host.name");

		for (const sl of rl.scopeLogs ?? []) {
			for (const log of sl.logRecords ?? []) {
				const logAttrs = flattenAttributes(log.attributes);
				const timeNano = log.timeUnixNano || log.observedTimeUnixNano;
				const timestamp = timeNano ? nanoToIso(timeNano) : new Date().toISOString();
				const level = severityToLevel(log.severityNumber);
				const message = bodyToString(log.body) || log.severityText || "log";

				const meta: Record<string, unknown> = {
					...logAttrs,
					otel: true,
				};
				if (log.severityNumber !== undefined) {
					meta.severity_number = log.severityNumber;
				}
				if (log.severityText) {
					meta.severity_text = log.severityText;
				}
				if (sl.scope?.name) {
					meta.instrumentation_scope = sl.scope.name;
				}
				if (Object.keys(resourceAttrs).length > 0) {
					meta.resource = resourceAttrs;
				}

				entries.push(
					validateEntry({
						timestamp,
						level,
						message,
						meta,
						service: serviceName,
						host: hostName,
						trace_id: log.traceId || undefined,
						span_id: log.spanId || undefined,
					}),
				);
			}
		}
	}

	// OTLP spec: empty-but-valid payloads return 200
	if (entries.length === 0) {
		return Response.json({ partialSuccess: {} }, { status: 200 });
	}

	if (entries.length > maxBatchSize) {
		return Response.json(
			{ error: `Batch too large: ${entries.length} entries exceeds max of ${maxBatchSize}` },
			{ status: 400 },
		);
	}

	db.insert(entries, keyPrefix);
	return Response.json({ partialSuccess: {} }, { status: 200 });
}
