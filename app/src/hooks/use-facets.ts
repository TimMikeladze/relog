import { useEffect, useRef, useState } from "react";
import { apiPost } from "@/api/client";
import { buildWhere, FACET_KEYS, type FacetKey } from "@/lib/log-filters";
import type { Filters, QueryResult } from "@/types";

export interface FacetEntry {
	value: string;
	count: number;
}

export type Facets = Record<FacetKey, FacetEntry[]>;

const EMPTY: Facets = {
	level: [],
	service: [],
	project: [],
	branch: [],
	version: [],
	deployment_id: [],
};

/** Per-dimension caps. Levels are a closed set; the rest are unbounded. */
const LIMITS: Record<FacetKey, number> = {
	level: 6,
	service: 50,
	project: 50,
	branch: 50,
	version: 50,
	deployment_id: 50,
};

/**
 * Counts for every facet dimension in one round trip.
 *
 * Each dimension is counted against the *other* active filters, so the numbers
 * describe the set you're currently looking at rather than the whole table.
 * The six branches are UNION ALLed because they only differ in their WHERE
 * clause — five separate POSTs per filter change was five times the round
 * trips for the same answer.
 */
export function useFacets(filters: Filters, enabled: boolean) {
	const [facets, setFacets] = useState<Facets>(EMPTY);
	const [loading, setLoading] = useState(false);
	const generation = useRef(0);

	// Depend on the serialised filters rather than the object: `useHashState`
	// hands back a fresh object every render, which would re-fire this on
	// every keystroke elsewhere in the app.
	const key = JSON.stringify(filters);

	useEffect(() => {
		if (!enabled) return;
		const gen = ++generation.current;
		const active: Filters = JSON.parse(key);

		const branches: string[] = [];
		const params: (string | number)[] = [];

		for (const dim of FACET_KEYS) {
			const where = buildWhere(active, dim);
			// `dim IS NOT NULL` has to join the existing clauses rather than be
			// appended with AND, since `where.sql` is empty when nothing is set.
			const predicate = where.sql
				? `${where.sql} AND ${dim} IS NOT NULL`
				: `WHERE ${dim} IS NOT NULL`;
			branches.push(
				`SELECT * FROM (SELECT '${dim}' AS dim, CAST(${dim} AS VARCHAR) AS value, ` +
					`COUNT(*) AS count FROM logs ${predicate} GROUP BY ${dim} ` +
					`ORDER BY count DESC LIMIT ${LIMITS[dim]})`,
			);
			params.push(...where.params);
		}

		setLoading(true);
		apiPost<QueryResult>("/query", { sql: branches.join(" UNION ALL "), params })
			.then((res) => {
				if (gen !== generation.current) return;
				const next: Facets = {
					level: [],
					service: [],
					project: [],
					branch: [],
					version: [],
					deployment_id: [],
				};
				for (const row of res.rows) {
					const dim = row.dim as FacetKey;
					if (!next[dim]) continue;
					next[dim].push({ value: String(row.value), count: Number(row.count) });
				}
				setFacets(next);
			})
			.catch(() => {
				// A facet count failing is not worth an error state — the menus
				// still work, they just can't show how many rows are behind each
				// option. Keep the last good counts rather than blanking them.
				if (gen !== generation.current) return;
			})
			.finally(() => {
				if (gen !== generation.current) return;
				setLoading(false);
			});
	}, [key, enabled]);

	return { facets, loading };
}
