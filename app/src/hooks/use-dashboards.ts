import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/api/client";
import { withQueryGate } from "@/lib/query-gate";
import type { Dashboard, DashboardVariable, QueryResult, VariableOption } from "@/types";

export const DEFAULT_DASHBOARD_ID = "logs";

export function useDashboards() {
	const [dashboards, setDashboards] = useState<Dashboard[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refetch = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiGet<{ dashboards: Dashboard[] }>("/dashboards");
			setDashboards(res.dashboards ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load dashboards");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refetch();
	}, [refetch]);

	const create = useCallback(async (d: Omit<Dashboard, "createdAt" | "updatedAt">) => {
		const res = await apiPost<{ dashboard: Dashboard }>("/dashboards", d);
		setDashboards((prev) => [...prev.filter((x) => x.id !== res.dashboard.id), res.dashboard]);
		return res.dashboard;
	}, []);

	const update = useCallback(
		async (id: string, patch: Partial<Omit<Dashboard, "id" | "createdAt">>) => {
			const res = await apiPut<{ dashboard: Dashboard }>(`/dashboards/${id}`, patch);
			setDashboards((prev) => prev.map((x) => (x.id === id ? res.dashboard : x)));
			return res.dashboard;
		},
		[],
	);

	const remove = useCallback(async (id: string) => {
		await apiDelete(`/dashboards/${id}`);
		setDashboards((prev) => prev.filter((x) => x.id !== id));
	}, []);

	return { dashboards, loading, error, refetch, create, update, remove };
}

export interface VariableOptionsState {
	/** Options per variable name. A variable with no source resolves to []. */
	options: Record<string, VariableOption[]>;
	loading: boolean;
}

/**
 * Resolves the choices for every `select` variable on a dashboard.
 *
 * Static `options` are used as-is; `optionsSql` is executed against /query.
 * Running the SQL client-side rather than server-side keeps this on exactly
 * the same path (and permissions) as widget data, so a variable can never
 * read something a widget could not.
 */
export function useVariableOptions(
	variables: DashboardVariable[],
	refreshKey: number,
): VariableOptionsState {
	const [options, setOptions] = useState<Record<string, VariableOption[]>>({});
	const [loading, setLoading] = useState(false);
	const runIdRef = useRef(0);

	// Identity of the variable list changes on every parent render; key on the
	// content that actually affects the result so this doesn't re-query
	// endlessly.
	const signature = useMemo(
		() =>
			JSON.stringify(
				variables.map((v) => [v.name, v.type, v.optionsSql ?? null, v.options ?? null]),
			),
		[variables],
	);

	useEffect(() => {
		const myRun = ++runIdRef.current;
		const declarations: DashboardVariable[] = JSON.parse(signature).map(
			([name, type, optionsSql, opts]: [
				string,
				DashboardVariable["type"],
				string | null,
				VariableOption[] | null,
			]) => ({ name, type, optionsSql: optionsSql ?? undefined, options: opts ?? undefined }),
		);

		const sqlBacked = declarations.filter((v) => v.type === "select" && v.optionsSql);
		const next: Record<string, VariableOption[]> = {};
		for (const v of declarations) {
			if (v.type === "select" && v.options) next[v.name] = v.options;
		}

		if (sqlBacked.length === 0) {
			setOptions(next);
			return;
		}

		setLoading(true);
		Promise.all(
			sqlBacked.map((v) =>
				withQueryGate(() => apiPost<QueryResult>("/query", { sql: v.optionsSql }))
					.then((res) => ({ name: v.name, rows: res.rows ?? [] }))
					// A broken options query must not take the dashboard down with
					// it — the variable just shows no choices beyond "All".
					.catch(() => ({ name: v.name, rows: [] as Record<string, unknown>[] })),
			),
		)
			.then((results) => {
				if (myRun !== runIdRef.current) return;
				for (const { name, rows } of results) {
					next[name] = rows
						.map((r) => {
							const value = r.value ?? Object.values(r)[0];
							if (value === null || value === undefined) return null;
							return {
								value: String(value),
								label: r.label === undefined || r.label === null ? String(value) : String(r.label),
							};
						})
						.filter((o): o is VariableOption => o !== null);
				}
				setOptions(next);
			})
			.finally(() => {
				if (myRun === runIdRef.current) setLoading(false);
			});
	}, [signature, refreshKey]);

	return { options, loading };
}
