import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	type Layout,
	type LayoutItem,
	ReactGridLayout as RGLBase,
	WidthProvider,
} from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/types";

const COLS = 12;
const ROW_HEIGHT = 60;
const MARGIN: readonly [number, number] = [12, 12];

const ReactGridLayoutWithWidth = WidthProvider(RGLBase);

export interface WidgetGridProps {
	widgets: Widget[];
	editMode: boolean;
	onLayoutChange: (updates: { id: string; layout: Widget["layout"] }[]) => void;
	renderWidget: (w: Widget) => React.ReactNode;
}

export function WidgetGrid({
	widgets,
	editMode,
	onLayoutChange,
	renderWidget,
}: WidgetGridProps) {
	const pendingRef = useRef<Map<string, Widget["layout"]>>(new Map());
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const flush = useCallback(() => {
		if (pendingRef.current.size === 0) return;
		const updates = Array.from(pendingRef.current.entries()).map(([id, layout]) => ({
			id,
			layout,
		}));
		pendingRef.current.clear();
		onLayoutChange(updates);
	}, [onLayoutChange]);

	const flushRef = useRef(flush);
	useEffect(() => {
		flushRef.current = flush;
	}, [flush]);

	useEffect(() => {
		if (!editMode) flush();
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [editMode, flush]);

	useEffect(() => {
		return () => {
			flushRef.current();
		};
	}, []);

	const handleLayoutChange = useCallback(
		(layouts: Layout) => {
			if (!editMode) return;
			const byId = new Map(widgets.map((w) => [w.id, w]));
			for (const l of layouts) {
				const prev = byId.get(l.i);
				if (!prev) continue;
				if (
					prev.layout.x !== l.x ||
					prev.layout.y !== l.y ||
					prev.layout.w !== l.w ||
					prev.layout.h !== l.h
				) {
					pendingRef.current.set(l.i, { x: l.x, y: l.y, w: l.w, h: l.h });
				}
			}
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(flush, 2000);
		},
		[widgets, editMode, flush],
	);

	const layout: LayoutItem[] = useMemo(
		() =>
			widgets.map((w) => ({
				i: w.id,
				x: w.layout.x,
				y: w.layout.y,
				w: w.layout.w,
				h: w.layout.h,
				minW: 2,
				minH: 2,
			})),
		[widgets],
	);

	return (
		<ReactGridLayoutWithWidth
			className="layout"
			layout={layout}
			cols={COLS}
			rowHeight={ROW_HEIGHT}
			isDraggable={editMode}
			isResizable={editMode}
			onLayoutChange={handleLayoutChange}
			compactType="vertical"
			margin={MARGIN}
			draggableCancel=".widget-no-drag"
		>
			{widgets.map((w) => (
				<div key={w.id} className="overflow-hidden rounded-lg border border-border bg-card">
					{renderWidget(w)}
				</div>
			))}
		</ReactGridLayoutWithWidth>
	);
}
