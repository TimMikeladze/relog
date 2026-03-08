import { useCallback, useEffect, useState } from "react";

/**
 * Reads/writes a single URL param within the existing hash format.
 * Setter atomically reads current hash, updates one key, and writes back.
 * If newValue === defaultValue, the key is deleted (keeps URLs clean).
 */
export function useHashParam(
	key: string,
	defaultValue?: string,
): [string | undefined, (v: string | undefined) => void] {
	const [value, setValue] = useState<string | undefined>(() => {
		const hash = window.location.hash.slice(1);
		const [, search] = hash.split("?");
		const params = new URLSearchParams(search || "");
		const val = params.get(key);
		return val !== null ? val : defaultValue;
	});

	useEffect(() => {
		const handler = () => {
			const hash = window.location.hash.slice(1);
			const [, search] = hash.split("?");
			const params = new URLSearchParams(search || "");
			const val = params.get(key);
			setValue(val !== null ? val : defaultValue);
		};
		window.addEventListener("hashchange", handler);
		return () => window.removeEventListener("hashchange", handler);
	}, [key, defaultValue]);

	const setParam = useCallback(
		(newValue: string | undefined) => {
			const hash = window.location.hash.slice(1);
			const [path, search] = hash.split("?");
			const params = new URLSearchParams(search || "");
			if (newValue === undefined || newValue === defaultValue) {
				params.delete(key);
			} else {
				params.set(key, newValue);
			}
			const searchStr = params.toString();
			window.location.hash = `${path || ""}${searchStr ? `?${searchStr}` : ""}`;
		},
		[key, defaultValue],
	);

	return [value, setParam];
}
