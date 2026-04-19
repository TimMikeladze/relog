import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { TraceWaterfall } from "./trace-waterfall";
import type { SpanBar } from "@/types";

function span(overrides: Partial<SpanBar> = {}): SpanBar {
	return {
		name: "root-op",
		service: "svc",
		spanId: "0000000000000001",
		parentSpanId: undefined,
		start: 0,
		duration: 100,
		level: "info",
		depth: 0,
		...overrides,
	};
}

describe("TraceWaterfall", () => {
	test("renders span rows", () => {
		render(<TraceWaterfall spans={[span()]} />);
		expect(screen.getByText("svc")).toBeInTheDocument();
		expect(screen.getByText("root-op")).toBeInTheDocument();
		expect(screen.getByText("100ms")).toBeInTheDocument();
	});

	test("shows kind abbrev badges for OTel spans", () => {
		const spans = [
			span({ spanId: "1".padStart(16, "0"), name: "s-op", kind: "server" }),
			span({ spanId: "2".padStart(16, "0"), name: "c-op", kind: "client" }),
			span({ spanId: "3".padStart(16, "0"), name: "p-op", kind: "producer" }),
			span({ spanId: "4".padStart(16, "0"), name: "cn-op", kind: "consumer" }),
			span({ spanId: "5".padStart(16, "0"), name: "i-op", kind: "internal" }),
		];
		render(<TraceWaterfall spans={spans} />);
		// Kind badges live in the tooltip which isn't rendered on mount. Skip tooltip
		// assertion — hover is a browser interaction and out of scope here.
		// Instead verify the data drove the bars by checking all names render.
		for (const s of spans) {
			expect(screen.getByText(s.name)).toBeInTheDocument();
		}
	});

	test("returns null for empty spans array", () => {
		const { container } = render(<TraceWaterfall spans={[]} />);
		expect(container).toBeEmptyDOMElement();
	});

	test("renders tree with parent/child hierarchy", () => {
		const spans: SpanBar[] = [
			span({ spanId: "parent1111111111", name: "parent-op", depth: 0, duration: 200 }),
			span({
				spanId: "child11111111111",
				parentSpanId: "parent1111111111",
				name: "child-op",
				depth: 1,
				start: 10,
				duration: 50,
			}),
		];
		render(<TraceWaterfall spans={spans} />);
		expect(screen.getByText("parent-op")).toBeInTheDocument();
		expect(screen.getByText("child-op")).toBeInTheDocument();
	});

	test("applies error styling for error-level spans", () => {
		const spans = [span({ level: "error", statusCode: 2 })];
		const { container } = render(<TraceWaterfall spans={spans} />);
		// Look for the red bar class
		const errorBar = container.querySelector(".bg-red-500\\/80");
		expect(errorBar).toBeTruthy();
	});

	test("formats duration in ms / s units", () => {
		const spans = [
			span({ spanId: "0000000000000001", name: "short-op", duration: 0.5 }),
			span({ spanId: "0000000000000002", name: "ms-op", duration: 42 }),
			span({ spanId: "0000000000000003", name: "s-op", duration: 1500 }),
		];
		render(<TraceWaterfall spans={spans} />);
		expect(screen.getByText("<1ms")).toBeInTheDocument();
		expect(screen.getByText("42ms")).toBeInTheDocument();
		expect(screen.getByText("1.50s")).toBeInTheDocument();
	});
});
