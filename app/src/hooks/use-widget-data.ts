import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/api/client";
import { substituteVars, type SqlVars } from "@/components/dashboard/sql-vars";
import { withQueryGate } from "@/lib/query-gate";
import type { DashboardVariable, QueryResult, Widget } from "@/types";

const TIME_RANGE_MS: Record<string, number> = {
	"1h": 3_600_000,
	"6h": 21_600_000,
	"24h": 86_400_000,
	"7d": 7 * 86_400_000,
	"30d": 30 * 86_400_000,
};

export const QUERY_TIMEOUT_MS = 15_000;

export interface WidgetFilters {
	timeRange: string;
	/** Current value of every variable the dashboard declares, keyed by name. */
	values?: Record<string, string>;
	/** Declarations, needed to type each value on its way into SQL. */
	variables?: DashboardVariable[];
	nowMs?: number;
}

export function resolveVars(widget: Widget, filters: WidgetFilters): SqlVars {
	const now = filters.nowMs ?? Date.now();
	// A widget may pin its own range — useful for a "last hour" tile sitting on
	// a 30-day dashboard — otherwise it follows the dashboard's picker.
	const rangeKey = widget.timeRange ?? filters.timeRange;
	const span = TIME_RANGE_MS[rangeKey] ?? TIME_RANGE_MS["24h"];
	const vars: SqlVars = { from: now - span, to: now };
	for (const [name, value] of Object.entries(filters.values ?? {})) {
		vars[name] = value === "" ? null : value;
	}
	return vars;
}

export interface WidgetDataState {
	rows: Record<string, unknown>[];
	columns: string[];
	loading: boolean;
	error: string | null;
	/** True when `rows` is the previous successful result; new fetch failed. */
	stale: boolean;
	reload: () => void;
}

export function useWidgetData(
	widget: Widget,
	filters: WidgetFilters,
	refreshKey: number,
): WidgetDataState {
	const [rows, setRows] = useState<Record<string, unknown>[]>([]);
	const [columns, setColumns] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stale, setStale] = useState(false);
	const [tick, setTick] = useState(0);
	const runIdRef = useRef(0);

	// Stabilize filter identity so the run callback doesn't re-create on
	// every parent render. With the previous `filters` object dep, any
	// unrelated parent state change re-fired the query and stole the next
	// auto-refresh tick. Note: nowMs is intentionally tracked because
	// changing it must trigger a re-query.
	//
	// Variable values and declarations are objects/arrays rebuilt each render,
	// so they are compared by serialized content rather than identity.
	const valuesKey = JSON.stringify(filters.values ?? {});
	const variablesKey = JSON.stringify(
		(filters.variables ?? []).map((v) => [v.name, v.type] as const),
	);
	const stableFilters = useMemo(
		() => ({
			timeRange: filters.timeRange,
			values: JSON.parse(valuesKey) as Record<string, string>,
			variables: (JSON.parse(variablesKey) as [string, DashboardVariable["type"]][]).map(
				([name, type]) => ({ name, type }) as DashboardVariable,
			),
			nowMs: filters.nowMs ?? null,
		}),
		[filters.timeRange, valuesKey, variablesKey, filters.nowMs],
	);

	const run = useCallback(async () => {
		const myRunId = ++runIdRef.current;
		setLoading(true);
		// Only clear the error if we have no successful prior result; that
		// way the user sees the old chart instead of an empty state during
		// a transient failure.
		try {
			const effectiveFilters: WidgetFilters = {
				timeRange: stableFilters.timeRange,
				values: stableFilters.values,
				variables: stableFilters.variables,
				nowMs: stableFilters.nowMs ?? undefined,
			};
			const vars = resolveVars(widget, effectiveFilters);
			const sql = substituteVars(widget.sql, vars, { variables: stableFilters.variables });
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const timeoutPromise = new Promise<QueryResult>((_, reject) => {
				timeoutHandle = setTimeout(() => reject(new Error("__timeout__")), QUERY_TIMEOUT_MS);
			});
			let result: QueryResult;
			try {
				result = await Promise.race<QueryResult>([
					withQueryGate(() => apiPost<QueryResult>("/query", { sql })),
					timeoutPromise,
				]);
			} finally {
				if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
			}
			if (myRunId !== runIdRef.current) return;
			const nextRows = result.rows ?? [];
			setRows(nextRows);
			setColumns(nextRows[0] ? Object.keys(nextRows[0]) : []);
			setError(null);
			setStale(false);
		} catch (err) {
			if (myRunId !== runIdRef.current) return;
			const msg =
				err instanceof Error && err.message === "__timeout__"
					? "Query timed out"
					: err instanceof Error
						? err.message
						: "Query failed";
			setError(msg);
			// Per-widget isolation: leave existing rows in place so a single
			// flaky widget can't blank the dashboard. Renderer interprets
			// `stale` only when rows.length > 0, so we always mark stale on
			// failure and let the renderer decide presentation.
			setStale(true);
		} finally {
			if (myRunId === runIdRef.current) setLoading(false);
		}
	}, [widget.id, widget.sql, widget.timeRange, stableFilters, tick]);

	// refreshKey is a dep so the auto-refresh interval triggers re-runs;
	// run already captures filter/widget via its own closure.
	useEffect(() => {
		void run();
		return () => {
			// Bump runId so any in-flight result is discarded
			runIdRef.current++;
		};
	}, [run, refreshKey]);

	return {
		rows,
		columns,
		loading,
		error,
		stale,
		reload: () => setTick((t) => t + 1),
	};
}
