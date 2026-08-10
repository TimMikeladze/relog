import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Layout, type LayoutItem, ReactGridLayout as RGLBase } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/types";

const COLS = 12;
const ROW_HEIGHT = 60;
const MARGIN: readonly [number, number] = [12, 12];
const FALLBACK_WIDTH = 1280;

/**
 * Measure the grid container ourselves instead of using RGL's `WidthProvider`.
 * That helper reads its container from a passive effect, so mounting the
 * dashboard right after a view switch (the app shell swaps the filter panel in
 * and out) captured the previous layout's width and never corrected itself —
 * the element never resizes again, so its ResizeObserver stays quiet and the
 * widgets sat at the wrong width until the next window resize.
 */
function useContainerWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);

	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const measure = () => setWidth(node.getBoundingClientRect().width);
		measure();
		// jsdom has no ResizeObserver — the one-shot measure above is enough there.
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	// The layout effect measures before the first paint, so the fallback only
	// ever reaches the DOM in environments without layout (jsdom).
	return [ref, width || FALLBACK_WIDTH] as const;
}

export interface WidgetGridProps {
	widgets: Widget[];
	editMode: boolean;
	onLayoutChange: (
		updates: { id: string; layout: Widget["layout"] }[],
		opts?: { keepalive?: boolean },
	) => void;
	renderWidget: (w: Widget) => React.ReactNode;
}

export function WidgetGrid({ widgets, editMode, onLayoutChange, renderWidget }: WidgetGridProps) {
	const [containerRef, width] = useContainerWidth();
	const pendingRef = useRef<Map<string, Widget["layout"]>>(new Map());
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const flush = useCallback(
		(opts?: { keepalive?: boolean }) => {
			if (pendingRef.current.size === 0) return;
			const updates = Array.from(pendingRef.current.entries()).map(([id, layout]) => ({
				id,
				layout,
			}));
			pendingRef.current.clear();
			// Only pass opts when it's actually meaningful — keeps the
			// common-case call site (`onLayoutChange(updates)`) compatible
			// with consumers that expect a single argument.
			if (opts) onLayoutChange(updates, opts);
			else onLayoutChange(updates);
		},
		[onLayoutChange],
	);

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

	// Persist pending layout changes if the user closes the tab or hides
	// it during the 2s debounce window. `keepalive: true` lets the PUT
	// finish after page unload — without it the request is aborted and
	// the layout move is lost.
	useEffect(() => {
		const beforeUnload = () => flushRef.current({ keepalive: true });
		const visibility = () => {
			if (document.visibilityState === "hidden") flushRef.current({ keepalive: true });
		};
		window.addEventListener("beforeunload", beforeUnload);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			document.removeEventListener("visibilitychange", visibility);
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
			debounceRef.current = setTimeout(() => flush(), 2000);
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
		<div ref={containerRef} className="w-full">
			<RGLBase
				className="layout"
				width={width}
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
			</RGLBase>
		</div>
	);
}
