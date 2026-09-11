/**
 * Minimal, zero-dependency OTLP/JSON example.
 *
 * Emits one trace (3 spans) and one log record directly to relog's OTLP
 * endpoints over HTTP. No OpenTelemetry SDK required — shows exactly what
 * relog accepts on the wire.
 *
 * Usage:
 *   bunx relog.sh start &
 *   bun examples/otel/otel-raw.ts
 *
 * Then open http://localhost:3485 and check the Traces view.
 */

const RELOG_URL = process.env.RELOG_URL ?? "http://localhost:3485";
const AUTH = process.env.RELOG_AUTH;

/** 16 random bytes -> 32 hex chars (OTel trace ID). */
function traceId(): string {
	return [...crypto.getRandomValues(new Uint8Array(16))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** 8 random bytes -> 16 hex chars (OTel span ID). */
function spanId(): string {
	return [...crypto.getRandomValues(new Uint8Array(8))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function nano(ms: number): string {
	return (BigInt(ms) * 1_000_000n).toString();
}

async function post(path: string, body: unknown): Promise<void> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (AUTH) headers.Authorization = `Bearer ${AUTH}`;

	const res = await fetch(`${RELOG_URL}${path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
	}
	console.log(`  ${path} → ${res.status}`);
}

async function sendTrace(): Promise<void> {
	const trace = traceId();
	const rootSpan = spanId();
	const authSpan = spanId();
	const dbSpan = spanId();

	const t0 = Date.now();
	const resource = {
		attributes: [
			{ key: "service.name", value: { stringValue: "checkout-api" } },
			{ key: "service.version", value: { stringValue: "1.4.2" } },
			{ key: "deployment.environment", value: { stringValue: "production" } },
			{ key: "host.name", value: { stringValue: "pod-abc-123" } },
		],
	};

	const payload = {
		resourceSpans: [
			{
				resource,
				scopeSpans: [
					{
						scope: { name: "example-instrumentation", version: "0.1.0" },
						spans: [
							{
								traceId: trace,
								spanId: rootSpan,
								name: "POST /checkout",
								kind: 2, // server
								startTimeUnixNano: nano(t0),
								endTimeUnixNano: nano(t0 + 240),
								attributes: [
									{ key: "http.method", value: { stringValue: "POST" } },
									{ key: "http.route", value: { stringValue: "/checkout" } },
									{ key: "http.status_code", value: { intValue: "200" } },
									{ key: "user.id", value: { stringValue: "usr_42" } },
								],
								status: { code: 1 }, // ok
							},
							{
								traceId: trace,
								spanId: authSpan,
								parentSpanId: rootSpan,
								name: "authenticate",
								kind: 1, // internal
								startTimeUnixNano: nano(t0 + 5),
								endTimeUnixNano: nano(t0 + 35),
								attributes: [{ key: "auth.provider", value: { stringValue: "jwt" } }],
								status: { code: 1 },
							},
							{
								traceId: trace,
								spanId: dbSpan,
								parentSpanId: rootSpan,
								name: "SELECT orders",
								kind: 3, // client
								startTimeUnixNano: nano(t0 + 40),
								endTimeUnixNano: nano(t0 + 210),
								attributes: [
									{ key: "db.system", value: { stringValue: "postgresql" } },
									{
										key: "db.statement",
										value: { stringValue: "SELECT * FROM orders WHERE id=$1" },
									},
									{ key: "db.rows_affected", value: { intValue: "1" } },
								],
								events: [
									{
										timeUnixNano: nano(t0 + 195),
										name: "slow_query_warning",
										attributes: [{ key: "threshold_ms", value: { intValue: "150" } }],
									},
								],
								status: { code: 1 },
							},
						],
					},
				],
			},
		],
	};

	console.log(`Trace ${trace} (3 spans)`);
	await post("/v1/traces", payload);
}

async function sendLog(): Promise<void> {
	const t0 = Date.now();
	const payload = {
		resourceLogs: [
			{
				resource: {
					attributes: [{ key: "service.name", value: { stringValue: "checkout-api" } }],
				},
				scopeLogs: [
					{
						scope: { name: "example-instrumentation" },
						logRecords: [
							{
								timeUnixNano: nano(t0),
								severityNumber: 9, // info (1-4 trace, 5-8 debug, 9-12 info, 13-16 warn, 17-20 error)
								severityText: "INFO",
								body: { stringValue: "checkout completed" },
								attributes: [
									{ key: "order.id", value: { stringValue: "ord_789" } },
									{ key: "order.total", value: { doubleValue: 42.5 } },
								],
							},
						],
					},
				],
			},
		],
	};

	console.log("Log record");
	await post("/v1/logs", payload);
}

async function main(): Promise<void> {
	console.log(`Sending OTLP/JSON to ${RELOG_URL}`);
	await sendTrace();
	await sendLog();
	console.log("Done. Open", RELOG_URL, "→ Traces tab.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
