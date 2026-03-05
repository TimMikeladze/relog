import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, setAuthKey, getAuthKey, setBaseUrl, getBaseUrl } from "@/api/client";
import type { HealthResponse } from "@/types";

interface AuthState {
	status: "checking" | "authenticated" | "needs-auth" | "error";
	key: string | null;
	serverUrl: string;
	error?: string;
}

interface AuthContextValue extends AuthState {
	login: (key: string) => Promise<void>;
	logout: () => void;
	setServerUrl: (url: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "relog:auth-key";
const STORAGE_URL = "relog:server-url";

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

	const checkAuth = useCallback(async () => {
		try {
			await apiGet<HealthResponse>("/health");
			setState((s) => ({ ...s, status: "authenticated" }));
		} catch (err: unknown) {
			if (
				err &&
				typeof err === "object" &&
				"status" in err &&
				(err as { status: number }).status === 401
			) {
				if (getAuthKey()) {
					setAuthKey(null);
					localStorage.removeItem(STORAGE_KEY);
					setState((s) => ({ ...s, status: "needs-auth", key: null, error: "Invalid API key" }));
				} else {
					setState((s) => ({ ...s, status: "needs-auth" }));
				}
			} else {
				setState((s) => ({
					...s,
					status: "error",
					error: `Cannot connect to ${getBaseUrl()}`,
				}));
			}
		}
	}, []);

	useEffect(() => {
		checkAuth();
	}, [checkAuth]);

	const login = useCallback(async (key: string) => {
		setAuthKey(key);
		localStorage.setItem(STORAGE_KEY, key);
		setState((s) => ({ ...s, key, status: "checking" }));
		try {
			await apiGet<HealthResponse>("/health");
			setState((s) => ({ ...s, status: "authenticated", error: undefined }));
		} catch {
			setAuthKey(null);
			localStorage.removeItem(STORAGE_KEY);
			setState((s) => ({ ...s, status: "needs-auth", key: null, error: "Invalid API key" }));
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
			setState((s) => ({ ...s, serverUrl: url, status: "checking" }));
			checkAuth();
		},
		[checkAuth],
	);

	return (
		<AuthContext.Provider value={{ ...state, login, logout, setServerUrl: setServerUrlCb }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}
