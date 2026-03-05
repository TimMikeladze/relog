import { useCallback, useEffect, useRef } from "react";

type KeyHandler = () => void;

interface KeyMap {
	[key: string]: KeyHandler;
}

export function useKeyboard(keyMap: KeyMap) {
	const pendingRef = useRef<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const handler = useCallback(
		(e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInput =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable ||
				target.closest(".cm-editor");

			// Meta/Ctrl combos always fire
			if (e.metaKey || e.ctrlKey) {
				const combo = `${e.metaKey ? "cmd" : "ctrl"}+${e.key.toLowerCase()}`;
				if (keyMap[combo]) {
					e.preventDefault();
					keyMap[combo]();
					return;
				}
				if (e.shiftKey) {
					const shiftCombo = `${e.metaKey ? "cmd" : "ctrl"}+shift+${e.key.toLowerCase()}`;
					if (keyMap[shiftCombo]) {
						e.preventDefault();
						keyMap[shiftCombo]();
						return;
					}
				}
				return;
			}

			// Don't process single keys when in an input
			if (isInput) {
				if (e.key === "Escape" && keyMap["Escape"]) {
					e.preventDefault();
					keyMap["Escape"]();
				}
				return;
			}

			// Chord handling (g + second key)
			if (pendingRef.current === "g") {
				clearTimeout(timerRef.current);
				pendingRef.current = null;
				const chord = `g ${e.key.toLowerCase()}`;
				if (keyMap[chord]) {
					e.preventDefault();
					keyMap[chord]();
					return;
				}
			}

			if (e.key === "g") {
				pendingRef.current = "g";
				timerRef.current = setTimeout(() => {
					pendingRef.current = null;
				}, 500);
				return;
			}

			const key = e.key === " " ? "Space" : e.key;
			if (keyMap[key]) {
				e.preventDefault();
				keyMap[key]();
			}
		},
		[keyMap],
	);

	useEffect(() => {
		window.addEventListener("keydown", handler);
		return () => {
			window.removeEventListener("keydown", handler);
			clearTimeout(timerRef.current);
		};
	}, [handler]);
}
