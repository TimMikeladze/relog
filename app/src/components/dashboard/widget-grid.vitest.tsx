import { render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import type { Widget } from "@/types";
import { WidgetGrid } from "./widget-grid";

type Layout = { i: string; x: number; y: number; w: number; h: number };
type MockCaller = (layout: Layout[]) => void;
let triggerLayoutChange: MockCaller | null = null;

vi.mock("react-grid-layout/legacy", () => ({
	default: ({
		children,
		onLayoutChange,
	}: {
		children: ReactNode;
		onLayoutChange?: (layout: Layout[]) => void;
	}) => {
		triggerLayoutChange = (l) => onLayoutChange?.(l);
		return <div data-testid="rgl-mock">{children}</div>;
	},
}));

vi.mock("react-grid-layout/css/styles.css", () => ({}));
vi.mock("react-resizable/css/styles.css", () => ({}));

function makeWidget(id: string): Widget {
	return {
		id,
		name: id,
		kind: "stat",
		sql: "SELECT 1",
		options: { valueField: "value" },
		layout: { x: 0, y: 0, w: 4, h: 2 },
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("WidgetGrid", () => {
	beforeEach(() => {
		triggerLayoutChange = null;
		vi.useFakeTimers();
	});

	test("does not emit when editMode is false", () => {
		const onLayoutChange = vi.fn();
		render(
			<WidgetGrid
				widgets={[makeWidget("a")]}
				editMode={false}
				width={1000}
				onLayoutChange={onLayoutChange}
				renderWidget={(w) => <span>{w.name}</span>}
			/>,
		);
		expect(triggerLayoutChange).not.toBeNull();
		act(() => {
			triggerLayoutChange!([{ i: "a", x: 2, y: 2, w: 6, h: 3 }]);
		});
		act(() => {
			vi.advanceTimersByTime(3000);
		});
		expect(onLayoutChange).not.toHaveBeenCalled();
	});

	test("emits after 2s debounce in edit mode", () => {
		const onLayoutChange = vi.fn();
		render(
			<WidgetGrid
				widgets={[makeWidget("a")]}
				editMode={true}
				width={1000}
				onLayoutChange={onLayoutChange}
				renderWidget={(w) => <span>{w.name}</span>}
			/>,
		);
		act(() => {
			triggerLayoutChange!([{ i: "a", x: 2, y: 2, w: 6, h: 3 }]);
		});
		expect(onLayoutChange).not.toHaveBeenCalled();
		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(onLayoutChange).toHaveBeenCalledWith([
			{ id: "a", layout: { x: 2, y: 2, w: 6, h: 3 } },
		]);
	});

	test("renders each widget via renderWidget", () => {
		render(
			<WidgetGrid
				widgets={[makeWidget("a"), makeWidget("b")]}
				editMode={false}
				width={1000}
				onLayoutChange={vi.fn()}
				renderWidget={(w) => <span data-testid={`tile-${w.id}`}>{w.name}</span>}
			/>,
		);
		expect(screen.getByTestId("tile-a")).toBeInTheDocument();
		expect(screen.getByTestId("tile-b")).toBeInTheDocument();
	});
});
