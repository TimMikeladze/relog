const DEFAULT_BASE_URL = window.location.origin;

let baseUrl = DEFAULT_BASE_URL;
let authKey: string | null = null;

export function setBaseUrl(url: string) {
	baseUrl = url.replace(/\/$/, "");
}

export function getBaseUrl(): string {
	return baseUrl;
}

export function setAuthKey(key: string | null) {
	authKey = key;
}

export function getAuthKey(): string | null {
	return authKey;
}

function headers(): Record<string, string> {
	const h: Record<string, string> = { "Content-Type": "application/json" };
	if (authKey) {
		h["Authorization"] = `Bearer ${authKey}`;
	}
	return h;
}

export async function apiGet<T>(
	path: string,
	params?: Record<string, string>,
	signal?: AbortSignal,
): Promise<T> {
	const url = new URL(path, baseUrl);
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			if (v) url.searchParams.set(k, v);
		}
	}
	const res = await fetch(url.toString(), { headers: headers(), signal });
	if (!res.ok) {
		throw new ApiError(res.status, await readErrorMessage(res));
	}
	return res.json() as Promise<T>;
}

/**
 * Best-effort error-body parsing. Upstream may return JSON (`{ error: "..." }`),
 * HTML (proxy 502 / gateway timeout), or empty. Try JSON first, fall through
 * to text, and finally use the HTTP status text — anything is more useful
 * to the user than the bare status code.
 */
async function readErrorMessage(res: Response): Promise<string> {
	const raw = await res.text().catch(() => "");
	if (!raw) return res.statusText || `HTTP ${res.status}`;
	try {
		const parsed = JSON.parse(raw) as { error?: string };
		if (parsed?.error) return parsed.error;
	} catch {
		// not JSON; fall through to truncated text
	}
	return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

interface ApiOptions {
	/** Pass `keepalive: true` for fire-and-forget calls during page unload. */
	keepalive?: boolean;
	/** Skip JSON response parsing (e.g. for 204 DELETE). */
	noBody?: boolean;
}

async function apiSend<T>(
	method: "POST" | "PUT" | "DELETE",
	path: string,
	body?: unknown,
	opts?: ApiOptions,
): Promise<T> {
	const init: RequestInit = {
		method,
		headers: headers(),
		keepalive: opts?.keepalive,
	};
	if (body !== undefined) init.body = JSON.stringify(body);
	const res = await fetch(`${baseUrl}${path}`, init);
	if (!res.ok) {
		throw new ApiError(res.status, await readErrorMessage(res));
	}
	if (opts?.noBody) return undefined as T;
	return res.json() as Promise<T>;
}

export function apiPost<T>(path: string, body: unknown, opts?: ApiOptions): Promise<T> {
	return apiSend<T>("POST", path, body, opts);
}

export function apiPut<T>(path: string, body: unknown, opts?: ApiOptions): Promise<T> {
	return apiSend<T>("PUT", path, body, opts);
}

export function apiDelete(path: string): Promise<void> {
	return apiSend<void>("DELETE", path, undefined, { noBody: true });
}

export function streamUrl(params?: Record<string, string>): string {
	const url = new URL("/stream", baseUrl);
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			if (v) url.searchParams.set(k, v);
		}
	}
	return url.toString();
}

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		this.name = "ApiError";
	}
}
