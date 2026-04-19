import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpanDetail } from "./span-detail";
import type { LogRecord, SpanBar } from "@/types";

function makeSpan(overrides: Partial<SpanBar> = {}): SpanBar {
	return {
		name: "POST /checkout",
		service: "checkout-api",
		spanId: "aabbccddeeff0011",
		parentSpanId: undefined,
		start: 0,
		duration: 240,
		level: "info",
		depth: 0,
		...overrides,
	};
}

function makeLog(overrides: Partial<LogRecord> = {}): LogRecord {
	return {
		id: 1,
		timestamp: "2026-04-19T12:00:00.000Z",
		level: "info",
		message: "POST /checkout",
		span_id: "aabbccddeeff0011",
		meta: {
			otel: true,
			span_kind: "server",
			span_status_code: 1,
			span_status_message: undefined,
			instrumentation_scope: "example-instrumentation",
			resource: {
				"service.name": "checkout-api",
				"service.version": "1.4.2",
				"deployment.environment": "production",
			},
			"http.method": "POST",
			"http.status_code": 200,
		},
		...overrides,
	};
}

describe("SpanDetail", () => {
	test("renders core attributes (span ID, duration, level)", () => {
		render(<SpanDetail span={makeSpan()} logs={[makeLog()]} onClose={() => {}} />);
		expect(screen.getByText("Span ID")).toBeInTheDocument();
		expect(screen.getByText("aabbccddeeff0011")).toBeInTheDocument();
		expect(screen.getByText("Duration")).toBeInTheDocument();
		expect(screen.getByText("240ms")).toBeInTheDocument();
	});

	test("surfaces OTel fields: kind, status, scope from meta", () => {
		render(<SpanDetail span={makeSpan()} logs={[makeLog()]} onClose={() => {}} />);
		expect(screen.getByText("Kind")).toBeInTheDocument();
		expect(screen.getByText("server")).toBeInTheDocument();
		expect(screen.getByText("Status")).toBeInTheDocument();
		expect(screen.getByText("ok")).toBeInTheDocument();
		expect(screen.getByText("Scope")).toBeInTheDocument();
		expect(screen.getByText("example-instrumentation")).toBeInTheDocument();
	});

	test("shows error status with message when status_code=2", () => {
		const log = makeLog({
			meta: {
				otel: true,
				span_kind: "server",
				span_status_code: 2,
				span_status_message: "internal server error",
				instrumentation_scope: "test",
			},
		});
		render(<SpanDetail span={makeSpan({ level: "error" })} logs={[log]} onClose={() => {}} />);
		// Status "error" label comes from SPAN_STATUS_LABEL[2] and has text-rose-500
		const statusRow = screen.getByText("Status").parentElement;
		expect(statusRow?.textContent).toContain("error");
		expect(screen.getByText("Status Msg")).toBeInTheDocument();
		expect(screen.getByText("internal server error")).toBeInTheDocument();
	});

	test("renders span attributes section with non-OTel attrs", () => {
		render(<SpanDetail span={makeSpan()} logs={[makeLog()]} onClose={() => {}} />);
		// Section header shows attribute count (http.method, http.status_code = 2)
		expect(screen.getByText(/Span Attributes \(2\)/i)).toBeInTheDocument();
	});

	test("renders resource section separately", () => {
		render(<SpanDetail span={makeSpan()} logs={[makeLog()]} onClose={() => {}} />);
		expect(screen.getByText(/Resource \(3\)/i)).toBeInTheDocument();
	});

	test("hides OTel-only sections when meta has no otel flag", () => {
		const log = makeLog({ meta: { some: "thing", other: 42 } });
		render(<SpanDetail span={makeSpan()} logs={[log]} onClose={() => {}} />);
		expect(screen.queryByText("Kind")).not.toBeInTheDocument();
		expect(screen.queryByText("Scope")).not.toBeInTheDocument();
		expect(screen.queryByText(/Resource \(/)).not.toBeInTheDocument();
		// Plain attributes still render as span attributes
		expect(screen.getByText(/Span Attributes \(2\)/i)).toBeInTheDocument();
	});

	test("onClose fires when close button clicked", async () => {
		const onClose = vi.fn();
		const { getByLabelText } = render(
			<SpanDetail span={makeSpan()} logs={[makeLog()]} onClose={onClose} />,
		);
		getByLabelText("Close span detail").click();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	test("parses meta string (legacy JSON string form)", () => {
		const log = makeLog({
			meta: JSON.stringify({
				otel: true,
				span_kind: "client",
				span_status_code: 1,
			}) as unknown as LogRecord["meta"],
		});
		render(<SpanDetail span={makeSpan()} logs={[log]} onClose={() => {}} />);
		expect(screen.getByText("client")).toBeInTheDocument();
	});
});
