import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/api/client";
import type { Widget } from "@/types";

export function useWidgets() {
	const [widgets, setWidgets] = useState<Widget[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refetch = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiGet<{ widgets: Widget[] }>("/widgets");
			setWidgets(res.widgets ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load widgets");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refetch();
	}, [refetch]);

	const create = useCallback(async (w: Omit<Widget, "createdAt" | "updatedAt">) => {
		const res = await apiPost<{ widget: Widget }>("/widgets", w);
		setWidgets((prev) => [...prev.filter((x) => x.id !== res.widget.id), res.widget]);
		return res.widget;
	}, []);

	const update = useCallback(
		async (id: string, patch: Partial<Omit<Widget, "id" | "createdAt">>) => {
			const res = await apiPut<{ widget: Widget }>(`/widgets/${id}`, patch);
			setWidgets((prev) => prev.map((x) => (x.id === id ? res.widget : x)));
			return res.widget;
		},
		[],
	);

	const remove = useCallback(async (id: string) => {
		await apiDelete(`/widgets/${id}`);
		setWidgets((prev) => prev.filter((x) => x.id !== id));
	}, []);

	return { widgets, loading, error, refetch, create, update, remove };
}
