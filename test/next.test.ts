import { afterEach, describe, expect, test } from "bun:test";
import { _resetSingleton, log, relogProxy, restoreConsole, createLogger } from "../src/next.ts";
import type { LogRecord } from "../src/types.ts";

afterEach(() => {
	_resetSingleton();
});

describe("createLogger", () => {
	test("register() creates singleton and patches console", async () => {
		const origLog = console.log;
		const relog = createLogger({ url: "http://localhost:1", captureConsole: true });
		await relog.register();

		// console.log should be patched (different reference)
		expect(console.log).not.toBe(origLog);
	});

	test("register() is idempotent (singleton guard)", async () => {
		const relog = createLogger({ url: "http://localhost:1" });
		await relog.register();
		const first = console.log;
		await relog.register();
		// Should be the same patched function — not double-patched
		expect(console.log).toBe(first);
	});

	test("captureConsole: false skips console patching", async () => {
		const origLog = console.log;
		const relog = createLogger({ url: "http://localhost:1", captureConsole: false });
		await relog.register();

		expect(console.log).toBe(origLog);
	});

	test("restoreConsole undoes patching", async () => {
		const origLog = console.log;
		const relog = createLogger({ url: "http://localhost:1" });
		await relog.register();
		expect(console.log).not.toBe(origLog);

		restoreConsole();
		expect(console.log).toBe(origLog);
	});
});

describe("console patching", () => {
	test("patched console.log preserves terminal output", async () => {
		// The key behavior: after patching, console.log still produces output
		// AND sends to relog. We verify the relog side by checking received logs.
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		console.log("hello from patched");

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat().find((r) => r.message === "hello from patched");
		expect(record).toBeDefined();
		expect(record!.meta!.source).toBe("console");

		server.stop();
	});

	test("recursion guard prevents infinite loop", async () => {
		// Create a server that will receive logs
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		// This should not cause infinite recursion even though
		// console.warn inside transport would trigger patched console
		console.log("test recursion guard");
		console.warn("test warn recursion");
		console.error("test error recursion");

		// If we got here without stack overflow, the guard works
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		server.stop();
	});
});

describe("onRequestError", () => {
	test("logs error with route context", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			captureConsole: false,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		relog.onRequestError(
			new Error("render failed"),
			{ method: "GET", url: "/dashboard", headers: {} },
			{ routerKind: "App Router", routePath: "/dashboard", routeType: "page" },
		);

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.message).toBe("render failed");
		expect(record.level).toBe("error");
		expect(record.meta!.routePath).toBe("/dashboard");
		expect(record.meta!.source).toBe("onRequestError");

		server.stop();
	});

	test("handles non-Error objects", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			captureConsole: false,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		relog.onRequestError(
			"string error",
			{ method: "POST", url: "/api/submit", headers: {} },
			{ routerKind: "App Router", routePath: "/api/submit", routeType: "route" },
		);

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.message).toBe("string error");

		server.stop();
	});

	test("no-op before register() is called", () => {
		const relog = createLogger({ url: "http://localhost:1", captureConsole: false });
		// Should not throw
		relog.onRequestError(
			new Error("noop"),
			{ method: "GET", url: "/", headers: {} },
			{ routerKind: "Pages", routePath: "/", routeType: "page" },
		);
	});
});

describe("relogProxy", () => {
	test("returns undefined without user middleware (lets Next.js continue)", async () => {
		const middleware = relogProxy();
		const request = new Request("http://localhost/api/test", { method: "GET" });
		const response = await middleware(request);

		expect(response).toBeUndefined();
	});

	test("passes through to user middleware with trace header", async () => {
		const userMiddleware = () =>
			new Response(JSON.stringify({ ok: true }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			});

		const middleware = relogProxy(userMiddleware);
		const request = new Request("http://localhost/api/test", { method: "POST" });
		const response = await middleware(request);

		expect(response).toBeDefined();
		expect(response!.status).toBe(201);
		expect(response!.headers.get("x-trace-id")).toBeDefined();
		expect(response!.headers.get("x-trace-id")!.length).toBe(32);
	});

	test("logs request when singleton exists", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			captureConsole: false,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		const userMiddleware = () => new Response(null, { status: 200 });
		const middleware = relogProxy(userMiddleware);
		const request = new Request("http://localhost/dashboard", { method: "GET" });
		await middleware(request);

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat().find((r) => r.meta?.source === "proxy");
		expect(record).toBeDefined();
		expect(record!.message).toContain("GET");
		expect(record!.message).toContain("/dashboard");
		expect(record!.meta!.method).toBe("GET");
		expect(record!.meta!.path).toBe("/dashboard");

		server.stop();
	});

	test("uses custom traceHeader from config", async () => {
		const relog = createLogger({
			url: "http://localhost:1",
			captureConsole: false,
			traceHeader: "x-request-id",
		});
		await relog.register();

		const userMiddleware = () => new Response(null, { status: 200 });
		const middleware = relogProxy(userMiddleware);
		const request = new Request("http://localhost/test", { method: "GET" });
		const response = await middleware(request);

		expect(response).toBeDefined();
		expect(response!.headers.get("x-request-id")).toBeDefined();
		expect(response!.headers.get("x-trace-id")).toBeNull();
	});
});

describe("console patching edge cases", () => {
	test("console.info is also patched", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		console.info("info message captured");

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat().find((r) => r.message === "info message captured");
		expect(record).toBeDefined();

		server.stop();
	});

	test("circular objects in console args do not throw", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		const circular: Record<string, unknown> = { a: 1 };
		circular.self = circular;

		// Should not throw
		console.log("circular test", circular);

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat().find((r) => r.message.includes("circular test"));
		expect(record).toBeDefined();

		server.stop();
	});
});

describe("log proxy", () => {
	test("log methods do not throw before register()", () => {
		// Should not throw, just silently drop (with a warning via originalConsole)
		log.info("before register");
		log.warn("before register");
		log.error("before register");
		log.debug("before register");
		log.trace("before register");
		log.fatal("before register");
	});

	test("log methods forward to singleton after register()", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const relog = createLogger({
			url: `http://localhost:${server.port}`,
			captureConsole: false,
			batchSize: 999,
			flushInterval: 60000,
		});
		await relog.register();

		log.info("explicit log", { userId: "123" });

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.message).toBe("explicit log");
		expect(record.meta!.userId).toBe("123");

		server.stop();
	});
});
