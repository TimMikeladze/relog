import { useCallback, useEffect, useMemo, useState } from "react";
import type { Filters, View } from "@/types";

function parseHash(): { view: View; filters: Filters; page: number } {
	const hash = window.location.hash.slice(1);
	const [path, search] = hash.split("?");
	const view = (path || "explore") as View;
	const params = new URLSearchParams(search || "");

	const filters: Filters = {};
	if (params.get("level")) filters.level = params.get("level")!;
	if (params.get("service")) filters.service = params.get("service")!;
	if (params.get("project")) filters.project = params.get("project")!;
	if (params.get("branch")) filters.branch = params.get("branch")!;
	if (params.get("version")) filters.version = params.get("version")!;
	if (params.get("deployment_id")) filters.deployment_id = params.get("deployment_id")!;
	if (params.get("grep")) filters.grep = params.get("grep")!;
	if (params.get("from")) filters.from = params.get("from")!;
	if (params.get("to")) filters.to = params.get("to")!;
	if (params.get("trace_id")) filters.trace_id = params.get("trace_id")!;

	const page = parseInt(params.get("page") || "1", 10);

	return { view, filters, page };
}

function buildHash(view: View, filters: Filters, page: number): string {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(filters)) {
		if (v) params.set(k, v);
	}
	if (page > 1) params.set("page", String(page));
	const search = params.toString();
	return `#${view}${search ? `?${search}` : ""}`;
}

export function useHashState() {
	const [state, setState] = useState(parseHash);

	useEffect(() => {
		const handler = () => setState(parseHash());
		window.addEventListener("hashchange", handler);
		return () => window.removeEventListener("hashchange", handler);
	}, []);

	const setView = useCallback(
		(view: View) => {
			window.location.hash = buildHash(view, state.filters, 1);
		},
		[state.filters],
	);

	const setFilters = useCallback(
		(filters: Filters) => {
			window.location.hash = buildHash(state.view, filters, 1);
		},
		[state.view],
	);

	const updateFilter = useCallback(
		(key: keyof Filters, value: string | undefined) => {
			const next = { ...state.filters };
			if (value) {
				next[key] = value;
			} else {
				delete next[key];
			}
			window.location.hash = buildHash(state.view, next, 1);
		},
		[state.view, state.filters],
	);

	const updateFilters = useCallback(
		(updates: Partial<Filters>) => {
			const next = { ...state.filters };
			for (const [k, v] of Object.entries(updates)) {
				if (v) {
					(next as Record<string, string>)[k] = v;
				} else {
					delete (next as Record<string, string | undefined>)[k];
				}
			}
			window.location.hash = buildHash(state.view, next, 1);
		},
		[state.view, state.filters],
	);

	const setPage = useCallback(
		(page: number) => {
			window.location.hash = buildHash(state.view, state.filters, page);
		},
		[state.view, state.filters],
	);

	return useMemo(
		() => ({ ...state, setView, setFilters, updateFilter, updateFilters, setPage }),
		[state, setView, setFilters, updateFilter, updateFilters, setPage],
	);
}
