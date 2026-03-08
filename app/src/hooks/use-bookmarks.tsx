import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Bookmark } from "@/types";

const STORAGE_KEY = "relog:bookmarks";

interface BookmarksContextValue {
	bookmarks: Bookmark[];
	add: (bookmark: Omit<Bookmark, "id" | "createdAt">) => void;
	remove: (id: string) => void;
	isBookmarked: (id: string) => boolean;
	toggle: (bookmark: Omit<Bookmark, "id" | "createdAt">) => void;
}

const BookmarksContext = createContext<BookmarksContextValue | null>(null);

function bookmarkId(b: Pick<Bookmark, "type" | "logRecord" | "traceId">): string {
	return b.type === "log" ? `log:${b.logRecord?.id}` : `trace:${b.traceId}`;
}

export function BookmarksProvider({ children }: { children: ReactNode }) {
	const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
		try {
			return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
		} catch {
			return [];
		}
	});

	const add = useCallback((b: Omit<Bookmark, "id" | "createdAt">) => {
		const id = bookmarkId(b);
		setBookmarks((prev) => {
			if (prev.some((x) => x.id === id)) return prev;
			const next = [...prev, { ...b, id, createdAt: Date.now() }];
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			return next;
		});
	}, []);

	const remove = useCallback((id: string) => {
		setBookmarks((prev) => {
			const next = prev.filter((b) => b.id !== id);
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			return next;
		});
	}, []);

	const isBookmarked = useCallback(
		(id: string) => bookmarks.some((b) => b.id === id),
		[bookmarks],
	);

	const toggle = useCallback(
		(b: Omit<Bookmark, "id" | "createdAt">) => {
			const id = bookmarkId(b);
			if (bookmarks.some((x) => x.id === id)) {
				remove(id);
			} else {
				add(b);
			}
		},
		[bookmarks, add, remove],
	);

	return (
		<BookmarksContext.Provider value={{ bookmarks, add, remove, isBookmarked, toggle }}>
			{children}
		</BookmarksContext.Provider>
	);
}

export function useBookmarks() {
	const ctx = useContext(BookmarksContext);
	if (!ctx) throw new Error("useBookmarks must be used within BookmarksProvider");
	return ctx;
}
