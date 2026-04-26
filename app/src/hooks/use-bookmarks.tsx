import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { Bookmark } from "@/types";

const STORAGE_KEY = "relog:bookmarks";

/**
 * Best-effort write to localStorage. Quota exhaustion would otherwise
 * propagate out of the React state setter and tear down the update batch
 * (the in-memory bookmark add/remove never commits, the UI looks broken).
 * Swallow the error and warn — the user keeps the in-memory state until
 * the tab reloads, which is far better than a partially-applied update.
 */
function safeSetItem(value: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, value);
	} catch (err) {
		console.warn("[relog] bookmarks localStorage write failed:", err);
	}
}

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

	// Mirror state in a ref so `toggle` can be a stable callback regardless of
	// the latest bookmarks value. Without this, `toggle` re-creates on every
	// add/remove and any consumer using it as an effect dep loops or
	// invalidates downstream memos (notably the LogRow row callbacks).
	const bookmarksRef = useRef(bookmarks);
	bookmarksRef.current = bookmarks;

	const add = useCallback((b: Omit<Bookmark, "id" | "createdAt">) => {
		const id = bookmarkId(b);
		setBookmarks((prev) => {
			if (prev.some((x) => x.id === id)) return prev;
			const next = [...prev, { ...b, id, createdAt: Date.now() }];
			safeSetItem(JSON.stringify(next));
			return next;
		});
	}, []);

	const remove = useCallback((id: string) => {
		setBookmarks((prev) => {
			const next = prev.filter((b) => b.id !== id);
			safeSetItem(JSON.stringify(next));
			return next;
		});
	}, []);

	const isBookmarked = useCallback((id: string) => bookmarks.some((b) => b.id === id), [bookmarks]);

	const toggle = useCallback(
		(b: Omit<Bookmark, "id" | "createdAt">) => {
			const id = bookmarkId(b);
			if (bookmarksRef.current.some((x) => x.id === id)) {
				remove(id);
			} else {
				add(b);
			}
		},
		[add, remove],
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
