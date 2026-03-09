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
		const body = await res.json().catch(() => ({}));
		throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
	}
	return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${baseUrl}${path}`, {
		method: "POST",
		headers: headers(),
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
	}
	return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${baseUrl}${path}`, {
		method: "PUT",
		headers: headers(),
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
	}
	return res.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
	const res = await fetch(`${baseUrl}${path}`, {
		method: "DELETE",
		headers: headers(),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
	}
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
