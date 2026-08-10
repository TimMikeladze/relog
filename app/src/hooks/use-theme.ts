import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "relog:theme";
const EVENT = "relog:theme-change";

function prefersDark(): boolean {
	if (typeof window === "undefined") return true;
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored) return stored === "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Apply a theme outside of React (command palette, keyboard shortcuts) and
 * notify every mounted `useTheme` consumer so toggles stay in sync.
 */
export function applyTheme(dark: boolean): void {
	document.documentElement.classList.toggle("dark", dark);
	localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
	window.dispatchEvent(new CustomEvent(EVENT, { detail: dark }));
}

export function toggleTheme(): void {
	applyTheme(!document.documentElement.classList.contains("dark"));
}

export function useTheme() {
	const [dark, setDark] = useState(prefersDark);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
		localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
	}, [dark]);

	useEffect(() => {
		const handler = (e: Event) => setDark((e as CustomEvent<boolean>).detail);
		window.addEventListener(EVENT, handler);
		return () => window.removeEventListener(EVENT, handler);
	}, []);

	const toggle = useCallback(() => setDark((v) => !v), []);

	return { dark, setDark, toggle };
}
