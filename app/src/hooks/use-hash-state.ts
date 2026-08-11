import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filters, View } from "@/types";

const VIEWS: View[] = ["explore", "traces", "query", "dashboard"];

/**
 * What a cold open lands on. Unbounded is the wrong default for a log store:
 * the timeline already renders the last hour, so leaving the table unfiltered
 * made the two disagree on screen and made the first query scan everything.
 * Only applied when the URL carries no state at all, so "All time" stays
 * reachable and shareable.
 */
const DEFAULT_RANGE = "1h";

function parseHash(): { view: View; filters: Filters; page: number } {
	const hash = window.location.hash.slice(1);
	const [path, search] = hash.split("?");
	// Anything else — a stale bookmark, a typo, "#/" — falls back to explore.
	// Consumers index lookup tables by view, so an unknown value would crash.
	const view = VIEWS.includes(path as View) ? (path as View) : "explore";
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
	if (params.get("bookmarked")) filters.bookmarked = params.get("bookmarked")!;
	if (params.get("around_id")) filters.around_id = params.get("around_id")!;

	const page = parseInt(params.get("page") || "1", 10);

	return { view, filters, page };
}

// Keys managed by useHashState — all others are view-specific UI state (live, detail, etc.)
const FILTER_KEYS = new Set([
	"level",
	"service",
	"project",
	"branch",
	"version",
	"deployment_id",
	"grep",
	"from",
	"to",
	"trace_id",
	"bookmarked",
	"around_id",
	"page",
]);

function buildHash(view: View, filters: Filters, page: number): string {
	const params = new URLSearchParams();

	// Preserve view-specific UI params (e.g. live, detail, expanded) when staying on same view.
	// currentPath may be "" when hash has no view prefix (e.g. first load or fresh hash).
	const currentHash = window.location.hash.slice(1);
	const [currentPath, currentSearch] = currentHash.split("?");
	if (currentPath === view || currentPath === "") {
		const currentParams = new URLSearchParams(currentSearch || "");
		for (const [k, v] of currentParams) {
			if (!FILTER_KEYS.has(k)) params.set(k, v);
		}
	}

	for (const [k, v] of Object.entries(filters)) {
		if (v) params.set(k, v);
	}
	if (page > 1) params.set("page", String(page));
	const search = params.toString();
	return `#${view}${search ? `?${search}` : ""}`;
}

export function useHashState() {
	const [state, setState] = useState(parseHash);
	const seeded = useRef(false);

	useEffect(() => {
		const handler = () => setState(parseHash());
		window.addEventListener("hashchange", handler);
		return () => window.removeEventListener("hashchange", handler);
	}, []);

	// Mount-only: a later hash with no params means the user cleared their
	// filters on purpose, and re-seeding then would make the range unclearable.
	useEffect(() => {
		if (seeded.current) return;
		seeded.current = true;
		const [, search] = window.location.hash.slice(1).split("?");
		if (search) return;
		window.location.replace(`#${state.view}?from=${DEFAULT_RANGE}`);
	}, [state.view]);

	const setView = useCallback(
		(view: View) => {
			window.location.hash = buildHash(view, state.filters, 1);
		},
		[state.filters],
	);

	/**
	 * Switch view and change filters in one hash write. Calling `updateFilter`
	 * and then `setView` loses the filter: both read `state.filters` from the
	 * same render, so the second write rebuilds the hash without the update.
	 */
	const navigate = useCallback(
		(view: View, updates: Partial<Filters>) => {
			const next = { ...state.filters };
			for (const [k, v] of Object.entries(updates)) {
				if (v) {
					(next as Record<string, string>)[k] = v;
				} else {
					delete (next as Record<string, string | undefined>)[k];
				}
			}
			window.location.hash = buildHash(view, next, 1);
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
		() => ({ ...state, setView, setFilters, updateFilter, updateFilters, setPage, navigate }),
		[state, setView, setFilters, updateFilter, updateFilters, setPage, navigate],
	);
}
