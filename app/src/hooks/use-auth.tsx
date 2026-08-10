import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { apiGet, setAuthKey, getAuthKey, setBaseUrl, getBaseUrl } from "@/api/client";

interface AuthState {
	/**
	 * `unreachable` = transport failed (CORS, DNS, refused, 5xx).
	 * `error`       = unexpected client error we don't know how to retry.
	 * `needs-auth`  = server replied 401 (genuine auth problem).
	 */
	status: "checking" | "authenticated" | "needs-auth" | "error" | "unreachable";
	key: string | null;
	serverUrl: string;
	error?: string;
	/** Wall-clock ms when the next automatic retry will fire. */
	nextRetryAt?: number;
}

interface AuthContextValue extends AuthState {
	login: (key: string) => Promise<void>;
	logout: () => void;
	setServerUrl: (url: string) => void;
	retryNow: () => void;
	/** True when the app is being served from the same origin as the API (i.e. local CLI mode) */
	isLocal: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "relog:auth-key";
const STORAGE_URL = "relog:server-url";

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AuthState>(() => {
		const savedUrl = localStorage.getItem(STORAGE_URL);
		if (savedUrl) setBaseUrl(savedUrl);
		const savedKey = localStorage.getItem(STORAGE_KEY);
		if (savedKey) setAuthKey(savedKey);
		return {
			status: "checking",
			key: savedKey,
			serverUrl: savedUrl || getBaseUrl(),
		};
	});

	const backoffRef = useRef(INITIAL_BACKOFF_MS);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearRetry = useCallback(() => {
		if (retryTimerRef.current) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}, []);

	const checkAuth = useCallback(async () => {
		clearRetry();
		try {
			// Probe a role-protected endpoint, not `/health` — health is public, so
			// probing it reported "authenticated" against a key-protected server
			// and every view then rendered "Unauthorized" with no key prompt.
			await apiGet<unknown>("/logs?limit=1");
			backoffRef.current = INITIAL_BACKOFF_MS;
			setState((s) => ({
				...s,
				status: "authenticated",
				error: undefined,
				nextRetryAt: undefined,
			}));
		} catch (err: unknown) {
			const status = (err as { status?: number } | null)?.status;
			if (status === 401) {
				backoffRef.current = INITIAL_BACKOFF_MS;
				if (getAuthKey()) {
					setAuthKey(null);
					localStorage.removeItem(STORAGE_KEY);
					setState((s) => ({
						...s,
						status: "needs-auth",
						key: null,
						error: "Invalid API key",
						nextRetryAt: undefined,
					}));
				} else {
					setState((s) => ({ ...s, status: "needs-auth", nextRetryAt: undefined }));
				}
				return;
			}
			// Anything else (network failure, 5xx, CORS) is "server unreachable" —
			// distinct from "your key is bad". Schedule a backoff retry so the
			// app self-heals when the server comes back without the user
			// reloading the tab.
			const delay = backoffRef.current;
			backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
			const nextRetryAt = Date.now() + delay;
			setState((s) => ({
				...s,
				status: "unreachable",
				error: `Cannot reach ${getBaseUrl()}${status ? ` (${status})` : ""}`,
				nextRetryAt,
			}));
			retryTimerRef.current = setTimeout(() => {
				retryTimerRef.current = null;
				void checkAuth();
			}, delay);
		}
	}, [clearRetry]);

	useEffect(() => {
		void checkAuth();
		return () => clearRetry();
	}, [checkAuth, clearRetry]);

	const retryNow = useCallback(() => {
		backoffRef.current = INITIAL_BACKOFF_MS;
		setState((s) => ({ ...s, status: "checking" }));
		void checkAuth();
	}, [checkAuth]);

	const login = useCallback(async (key: string) => {
		setAuthKey(key);
		localStorage.setItem(STORAGE_KEY, key);
		setState((s) => ({ ...s, key, status: "checking" }));
		try {
			// Same protected probe as `checkAuth` — a public endpoint would
			// accept any key the user types.
			await apiGet<unknown>("/logs?limit=1");
			setState((s) => ({ ...s, status: "authenticated", error: undefined }));
		} catch (err: unknown) {
			// Distinguish "wrong key" (401) from "server down" — clearing
			// the key on a 5xx would force the user to re-enter it once the
			// server recovers, which is annoying and gives no real signal.
			const status = (err as { status?: number } | null)?.status;
			if (status === 401) {
				setAuthKey(null);
				localStorage.removeItem(STORAGE_KEY);
				setState((s) => ({ ...s, status: "needs-auth", key: null, error: "Invalid API key" }));
			} else {
				setState((s) => ({
					...s,
					status: "unreachable",
					error: `Cannot reach ${getBaseUrl()}${status ? ` (${status})` : ""}`,
				}));
			}
		}
	}, []);

	const logout = useCallback(() => {
		setAuthKey(null);
		localStorage.removeItem(STORAGE_KEY);
		setState((s) => ({ ...s, status: "needs-auth", key: null }));
	}, []);

	const setServerUrlCb = useCallback(
		(url: string) => {
			setBaseUrl(url);
			localStorage.setItem(STORAGE_URL, url);
			backoffRef.current = INITIAL_BACKOFF_MS;
			setState((s) => ({ ...s, serverUrl: url, status: "checking" }));
			void checkAuth();
		},
		[checkAuth],
	);

	const isLocal = state.serverUrl === window.location.origin;

	return (
		<AuthContext.Provider
			value={{ ...state, login, logout, setServerUrl: setServerUrlCb, retryNow, isLocal }}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}
