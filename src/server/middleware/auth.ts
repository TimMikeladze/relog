import { createHash, timingSafeEqual } from "node:crypto";

export type Role = "ingest" | "read" | "admin";

export interface AuthKeys {
	ingestKey?: string;
	readKey?: string;
	adminKey?: string;
}

const ROLE_HIERARCHY: Record<Role, Set<Role>> = {
	admin: new Set(["admin", "read", "ingest"]),
	read: new Set(["read", "ingest"]),
	ingest: new Set(["ingest"]),
};

function sha256(input: string): Buffer {
	return createHash("sha256").update(input).digest();
}

function safeEquals(a: string, b: string): boolean {
	return timingSafeEqual(sha256(a), sha256(b));
}

function resolveRole(token: string, keys: AuthKeys): Role | null {
	if (keys.adminKey && safeEquals(token, keys.adminKey)) return "admin";
	if (keys.readKey && safeEquals(token, keys.readKey)) return "read";
	if (keys.ingestKey && safeEquals(token, keys.ingestKey)) return "ingest";
	return null;
}

export function checkRole(request: Request, requiredRole: Role, keys: AuthKeys): Response | null {
	const hasAnyKey = keys.ingestKey || keys.readKey || keys.adminKey;
	if (!hasAnyKey) return null;

	const header = request.headers.get("Authorization");
	if (!header) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const match = header.match(/^Bearer\s+(.+)$/);
	if (!match) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const token = match[1]!;
	const role = resolveRole(token, keys);

	if (!role) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (!ROLE_HIERARCHY[role].has(requiredRole)) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	return null;
}
