import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/api/client";
import { substituteVars, type SqlVars } from "@/components/dashboard/sql-vars";
import type { QueryResult, Widget } from "@/types";

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
	service?: string | null;
	project?: string | null;
	nowMs?: number;
}

export function resolveVars(widget: Widget, filters: WidgetFilters): SqlVars {
	const now = filters.nowMs ?? Date.now();
	const rangeKey = widget.timeRange ?? filters.timeRange;
	const span = TIME_RANGE_MS[rangeKey] ?? TIME_RANGE_MS["24h"];
	return {
		from: now - span,
		to: now,
		service: filters.service ?? null,
		project: filters.project ?? null,
	};
}

export interface WidgetDataState {
	rows: Record<string, unknown>[];
	columns: string[];
	loading: boolean;
	error: string | null;
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
	const [tick, setTick] = useState(0);
	const runIdRef = useRef(0);

	const run = useCallback(async () => {
		const myRunId = ++runIdRef.current;
		setLoading(true);
		setError(null);
		try {
			const vars = resolveVars(widget, filters);
			const sql = substituteVars(widget.sql, vars);
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const timeoutPromise = new Promise<QueryResult>((_, reject) => {
				timeoutHandle = setTimeout(() => reject(new Error("__timeout__")), QUERY_TIMEOUT_MS);
			});
			let result: QueryResult;
			try {
				result = await Promise.race<QueryResult>([
					apiPost<QueryResult>("/query", { sql }),
					timeoutPromise,
				]);
			} finally {
				if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
			}
			if (myRunId !== runIdRef.current) return;
			const nextRows = result.rows ?? [];
			setRows(nextRows);
			setColumns(nextRows[0] ? Object.keys(nextRows[0]) : []);
		} catch (err) {
			if (myRunId !== runIdRef.current) return;
			if (err instanceof Error && err.message === "__timeout__") {
				setError("Query timed out");
			} else {
				setError(err instanceof Error ? err.message : "Query failed");
			}
		} finally {
			if (myRunId === runIdRef.current) setLoading(false);
		}
	}, [widget, filters, tick]);

	useEffect(() => {
		run();
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
		reload: () => setTick((t) => t + 1),
	};
}
