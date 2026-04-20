import { useCallback, useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "@/api/client";
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

export function useCanEditWidgets(): boolean {
	const [canEdit, setCanEdit] = useState(false);
	useEffect(() => {
		let cancelled = false;
		apiPost("/widgets", {})
			.then(() => {
				if (!cancelled) setCanEdit(true);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				const status = err instanceof ApiError ? err.status : 0;
				// 400 = validation error -> we're authenticated as admin (server accepted the call)
				// 401 / 403 = not admin -> no edit
				setCanEdit(status === 400);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	return canEdit;
}
