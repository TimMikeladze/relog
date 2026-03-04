import { timingSafeEqual } from "node:crypto";

export function checkAuth(request: Request, expectedAuth: string | undefined): Response | null {
	if (!expectedAuth) return null;

	const header = request.headers.get("Authorization");
	if (!header) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const expected = `Basic ${Buffer.from(expectedAuth).toString("base64")}`;
	const a = Buffer.from(header);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	return null;
}
