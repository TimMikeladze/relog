import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Widget } from "@/types";
import { WidgetRenderer } from "./widget-renderer";

function widgetOf(kind: Widget["kind"], opts: object): Widget {
	return {
		id: "w",
		name: "w",
		kind,
		sql: "",
		options: opts as Widget["options"],
		layout: { x: 0, y: 0, w: 4, h: 2 },
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("WidgetRenderer", () => {
	test("shows error state", () => {
		const w = widgetOf("stat", { valueField: "v" });
		render(
			<WidgetRenderer widget={w} rows={[]} columns={[]} loading={false} error="boom" />,
		);
		expect(screen.getByText("boom")).toBeInTheDocument();
	});

	test("shows empty state on zero rows", () => {
		const w = widgetOf("stat", { valueField: "v" });
		render(
			<WidgetRenderer widget={w} rows={[]} columns={[]} loading={false} error={null} />,
		);
		expect(screen.getByText(/no data/i)).toBeInTheDocument();
	});

	test("stat widget missing field renders error", () => {
		const w = widgetOf("stat", { valueField: "nope" });
		render(
			<WidgetRenderer
				widget={w}
				rows={[{ other: 1 }]}
				columns={["other"]}
				loading={false}
				error={null}
			/>,
		);
		expect(screen.getByText(/missing column: nope/i)).toBeInTheDocument();
	});

	test("stat widget renders formatted number", () => {
		const w = widgetOf("stat", { valueField: "v", format: "number" });
		render(
			<WidgetRenderer
				widget={w}
				rows={[{ v: 1234 }]}
				columns={["v"]}
				loading={false}
				error={null}
			/>,
		);
		expect(screen.getByText("1,234")).toBeInTheDocument();
	});
});
