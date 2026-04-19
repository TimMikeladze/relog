/**
 * OpenTelemetry SDK example — emits spans to relog via the official
 * OTLP/HTTP/JSON exporter. This is the realistic production path: auto
 * instrumentation + manual spans pointed at relog's /v1/traces endpoint.
 *
 * Install deps first:
 *   bun add @opentelemetry/api @opentelemetry/sdk-node \
 *           @opentelemetry/resources @opentelemetry/semantic-conventions \
 *           @opentelemetry/exporter-trace-otlp-http
 *
 * Run:
 *   bunx relog.dev start &
 *   bun examples/otel/otel-sdk.ts
 */

import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const RELOG_URL = process.env.RELOG_URL ?? "http://localhost:3485";
const AUTH = process.env.RELOG_AUTH;

const sdk = new NodeSDK({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: "otel-sdk-example",
		[ATTR_SERVICE_VERSION]: "0.1.0",
		"deployment.environment": "local",
	}),
	traceExporter: new OTLPTraceExporter({
		url: `${RELOG_URL}/v1/traces`,
		headers: AUTH ? { Authorization: `Bearer ${AUTH}` } : undefined,
	}),
});

sdk.start();

const tracer = trace.getTracer("example-tracer");

async function doWork(): Promise<void> {
	await tracer.startActiveSpan(
		"handle-request",
		{ kind: SpanKind.SERVER, attributes: { "http.method": "GET", "http.route": "/api/items" } },
		async (root) => {
			await tracer.startActiveSpan("db.query", { kind: SpanKind.CLIENT }, async (db) => {
				db.setAttribute("db.system", "sqlite");
				db.setAttribute("db.statement", "SELECT * FROM items LIMIT 10");
				await new Promise((r) => setTimeout(r, 40));
				db.end();
			});

			await tracer.startActiveSpan("render", { kind: SpanKind.INTERNAL }, async (render) => {
				await new Promise((r) => setTimeout(r, 15));
				render.addEvent("cache.miss", { key: "items:home" });
				render.end();
			});

			root.setStatus({ code: SpanStatusCode.OK });
			root.end();
		},
	);
}

async function main(): Promise<void> {
	console.log(`Exporting to ${RELOG_URL}/v1/traces`);
	await doWork();
	// Let the batch span processor flush before exit
	await sdk.shutdown();
	console.log("Done. Open", RELOG_URL, "→ Traces tab.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
