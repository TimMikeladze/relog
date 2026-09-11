import { afterEach, describe, expect, test } from "bun:test";
import { formatLogRecord, originalConsole } from "../src/console.ts";
import { EventBuilder } from "../src/event.ts";
import { createLogger, Logger } from "../src/logger.ts";
import { Transport } from "../src/transport.ts";
import {
	resolveAuth,
	resolveAuthHeader,
	authHeaders,
	buildParams,
	escapeCsv,
} from "../src/cli/shared.ts";
import type { LogRecord } from "../src/types.ts";

describe("Logger", () => {
	test("createLogger returns a Logger instance", () => {
		const log = createLogger({ console: false });
		expect(log).toBeInstanceOf(Logger);
	});

	test("child logger inherits parent meta and trace_id", () => {
		const log = createLogger({
			service: "test-svc",
			console: false,
			traceId: "trace-abc",
		});
		const child = log.child({ requestId: "abc-123" });
		expect(child).toBeInstanceOf(Logger);
	});

	test("child logger can override trace_id and span_id", () => {
		const log = createLogger({
			console: false,
			traceId: "parent-trace",
		});
		const child = log.child({
			traceId: "child-trace",
			spanId: "span-123",
		});
		expect(child).toBeInstanceOf(Logger);
	});

	test("error() accepts Error objects", () => {
		const log = createLogger({ console: false });
		const err = new Error("test error");
		// Should not throw
		log.error(err);
		log.error(err, { extra: "context" });
	});

	test("all level methods accept string or Error", () => {
		const log = createLogger({ console: false });
		log.trace("trace msg");
		log.debug("debug msg");
		log.info("info msg");
		log.warn("warn msg");
		log.error("error msg");
		log.fatal("fatal msg");
		log.info(new Error("info error"));
	});

	test("setLevel changes filtering", () => {
		const log = createLogger({ level: "error", console: false });
		// After setLevel, lower levels should work
		log.setLevel("trace");
		log.trace("should not throw");
	});

	test("createLogger with zero-config", () => {
		const log = createLogger({ console: false });
		expect(log).toBeInstanceOf(Logger);
		log.info("zero config log");
	});

	test("destroy is async and does not throw", async () => {
		const log = createLogger({ console: false });
		await log.destroy();
	});

	test("flush does not throw when no transport", async () => {
		const log = createLogger({ console: false });
		await log.flush();
	});
});

describe("Transport", () => {
	test("buffers logs and flushes on batch size", async () => {
		let flushed: unknown[] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = await req.json();
				flushed = body as unknown[];
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 2,
			flushInterval: 60000,
		});

		log.info("msg1");
		log.info("msg2");

		// Wait for the flush triggered by batchSize
		await new Promise((r) => setTimeout(r, 200));

		expect(flushed.length).toBe(2);
		await log.destroy();
		server.stop();
	});

	test("transport respects maxBufferSize", () => {
		const log = createLogger({
			url: "http://localhost:1",
			console: false,
			batchSize: 99999,
			flushInterval: 60000,
			maxBufferSize: 10,
		});

		for (let i = 0; i < 15; i++) {
			log.info(`msg-${i}`);
		}

		// Should not throw; buffer should not exceed maxBufferSize
		log.info("final");
	});

	test("flush sends buffered logs", async () => {
		let received = 0;
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as unknown[];
				received += body.length;
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.info("buffered-1");
		log.info("buffered-2");
		await log.flush();

		expect(received).toBe(2);
		await log.destroy();
		server.stop();
	});
});

describe("Transport retry logic", () => {
	test("4xx (non-429) stops retrying immediately", async () => {
		let attempts = 0;
		const server = Bun.serve({
			port: 0,
			fetch() {
				attempts++;
				return new Response("Bad Request", { status: 400 });
			},
		});

		const errors: { error: Error; batch: LogRecord[] }[] = [];
		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 1,
			flushInterval: 60000,
			onError: (error, batch) => errors.push({ error, batch }),
		});

		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "test-4xx",
		});

		await new Promise((r) => setTimeout(r, 500));

		expect(attempts).toBe(1);
		expect(errors.length).toBe(1);
		expect(errors[0]!.error.message).toContain("400");

		transport.destroy();
		server.stop();
	});

	test("5xx retries up to 3 times", async () => {
		let attempts = 0;
		const server = Bun.serve({
			port: 0,
			fetch() {
				attempts++;
				return new Response("Server Error", { status: 500 });
			},
		});

		const errors: Error[] = [];
		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 1,
			flushInterval: 60000,
			onError: (error) => errors.push(error),
		});

		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "test-5xx",
		});

		// Backoff: 500ms + 1000ms + some overhead
		await new Promise((r) => setTimeout(r, 3000));

		expect(attempts).toBe(3);
		expect(errors.length).toBe(1);

		transport.destroy();
		server.stop();
	}, 10000);

	test("onError callback receives error and batch after exhausted retries", async () => {
		const server = Bun.serve({
			port: 0,
			fetch() {
				return new Response("Bad", { status: 400 });
			},
		});

		let receivedError: Error | undefined;
		let receivedBatch: LogRecord[] | undefined;

		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 1,
			flushInterval: 60000,
			onError: (error, batch) => {
				receivedError = error;
				receivedBatch = batch;
			},
		});

		const record: LogRecord = {
			timestamp: new Date().toISOString(),
			level: "info",
			message: "error-callback-test",
		};
		transport.send(record);
		await new Promise((r) => setTimeout(r, 500));

		expect(receivedError).toBeDefined();
		expect(receivedBatch).toBeDefined();
		expect(receivedBatch!.length).toBe(1);
		expect(receivedBatch![0]!.message).toBe("error-callback-test");

		transport.destroy();
		server.stop();
	});

	test("console.warn fallback when no onError", async () => {
		const server = Bun.serve({
			port: 0,
			fetch() {
				return new Response("Bad", { status: 400 });
			},
		});

		const warnings: unknown[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 1,
			flushInterval: 60000,
		});

		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "warn-fallback-test",
		});
		await new Promise((r) => setTimeout(r, 500));

		console.warn = origWarn;

		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings.some((w) => String(w).includes("[relog.sh]"))).toBe(true);

		transport.destroy();
		server.stop();
	});

	test("send() after destroy() is a no-op", async () => {
		let attempts = 0;
		const server = Bun.serve({
			port: 0,
			fetch() {
				attempts++;
				return Response.json({ ok: true });
			},
		});

		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 1,
			flushInterval: 60000,
		});

		transport.destroy();
		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "after-destroy",
		});

		await new Promise((r) => setTimeout(r, 300));
		expect(attempts).toBe(0);

		server.stop();
	});

	test("concurrent flush sets pendingFlush", async () => {
		let flushCount = 0;
		const server = Bun.serve({
			port: 0,
			async fetch() {
				flushCount++;
				await new Promise((r) => setTimeout(r, 100));
				return Response.json({ ok: true });
			},
		});

		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 999,
			flushInterval: 60000,
		});

		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "flush-1",
		});

		// Start first flush
		const p1 = transport.flush();

		// Send more and trigger second flush while first is in progress
		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "flush-2",
		});
		const p2 = transport.flush();

		await p1;
		await p2;
		// Let pending flush complete
		await new Promise((r) => setTimeout(r, 300));

		expect(flushCount).toBeGreaterThanOrEqual(1);

		transport.destroy();
		server.stop();
	});
});

describe("Logger behavior", () => {
	test("level filtering: warn level ignores info but sends warn+", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			level: "warn",
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.info("should-be-filtered");
		log.debug("should-be-filtered-too");
		log.warn("should-send");
		log.error("should-send-too");

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const allMessages = received.flat().map((r) => r.message);
		expect(allMessages).not.toContain("should-be-filtered");
		expect(allMessages).not.toContain("should-be-filtered-too");
		expect(allMessages).toContain("should-send");
		expect(allMessages).toContain("should-send-too");

		await log.destroy();
		server.stop();
	});

	test("Error object serializes to meta with error, name, stack fields", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		const err = new TypeError("something broke");
		log.error(err);
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.message).toBe("something broke");
		expect(record.meta).toBeDefined();
		expect(record.meta!.error).toBe("something broke");
		expect(record.meta!.name).toBe("TypeError");
		expect(typeof record.meta!.stack).toBe("string");

		await log.destroy();
		server.stop();
	});

	test("child() merges parent + child meta, child wins on conflict", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			meta: { env: "test", shared: "parent" },
			batchSize: 999,
			flushInterval: 60000,
		});

		const child = log.child({ requestId: "req-1", shared: "child" });
		child.info("child-msg");
		await child.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.meta!.env).toBe("test");
		expect(record.meta!.requestId).toBe("req-1");
		expect(record.meta!.shared).toBe("child");

		await log.destroy();
		server.stop();
	});

	test("child().destroy() does NOT destroy shared transport", async () => {
		let flushCount = 0;
		const server = Bun.serve({
			port: 0,
			async fetch() {
				flushCount++;
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		const child = log.child({ childMeta: true });
		await child.destroy();

		// Parent should still work after child destroy
		log.info("after-child-destroy");
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		expect(flushCount).toBeGreaterThan(0);

		await log.destroy();
		server.stop();
	});

	test("setLevel changes filtering dynamically", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			level: "error",
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.info("before-setlevel");
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const beforeMessages = received.flat().map((r) => r.message);
		expect(beforeMessages).not.toContain("before-setlevel");

		log.setLevel("debug");
		log.info("after-setlevel");
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const afterMessages = received.flat().map((r) => r.message);
		expect(afterMessages).toContain("after-setlevel");

		await log.destroy();
		server.stop();
	});
});

describe("Transport auth and edge cases", () => {
	test("auth header is sent as Bearer token", async () => {
		let receivedAuth = "";
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				receivedAuth = req.headers.get("Authorization") ?? "";
				return Response.json({ ok: true });
			},
		});

		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			auth: "my-api-key",
			batchSize: 1,
			flushInterval: 60000,
		});

		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "auth-test",
		});

		await new Promise((r) => setTimeout(r, 500));

		expect(receivedAuth).toBe("Bearer my-api-key");

		transport.destroy();
		server.stop();
	});

	test("429 status code retries (not treated as fatal 4xx)", async () => {
		let attempts = 0;
		const server = Bun.serve({
			port: 0,
			fetch() {
				attempts++;
				if (attempts < 3)
					return new Response("Too Many Requests", {
						status: 429,
						headers: { "Retry-After": "1" },
					});
				return Response.json({ ok: true });
			},
		});

		const errors: Error[] = [];
		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 1,
			flushInterval: 60000,
			onError: (error) => errors.push(error),
		});

		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "test-429",
		});

		await new Promise((r) => setTimeout(r, 6000));

		expect(attempts).toBe(3);
		expect(errors.length).toBe(0); // Should have succeeded on 3rd attempt

		transport.destroy();
		server.stop();
	}, 15000);

	test("network error (connection refused) retries", async () => {
		const errors: Error[] = [];
		const transport = new Transport({
			url: "http://localhost:1", // port 1 = connection refused
			batchSize: 1,
			flushInterval: 60000,
			onError: (error) => errors.push(error),
		});

		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "test-conn-refused",
		});

		await new Promise((r) => setTimeout(r, 4000));

		expect(errors.length).toBe(1);
		expect(errors[0]!.message.length).toBeGreaterThan(0); // Network error message

		transport.destroy();
	}, 10000);

	test("buffer overflow drops oldest 10%", () => {
		const transport = new Transport({
			url: "http://localhost:1",
			batchSize: 99999,
			flushInterval: 60000,
			maxBufferSize: 10,
		});

		for (let i = 0; i < 10; i++) {
			transport.send({
				timestamp: new Date().toISOString(),
				level: "info",
				message: `buf-${i}`,
			});
		}

		// Buffer is full at 10. Next send should drop oldest 10% (1 item) then add.
		transport.send({
			timestamp: new Date().toISOString(),
			level: "info",
			message: "overflow",
		});

		// Should not throw, buffer should be at 10 (dropped 1, added 1)
		transport.destroy();
	});

	test("flush on empty buffer is no-op", async () => {
		let fetchCalls = 0;
		const server = Bun.serve({
			port: 0,
			fetch() {
				fetchCalls++;
				return Response.json({ ok: true });
			},
		});

		const transport = new Transport({
			url: `http://localhost:${server.port}`,
			batchSize: 999,
			flushInterval: 60000,
		});

		await transport.flush();
		expect(fetchCalls).toBe(0);

		transport.destroy();
		server.stop();
	});
});

describe("Logger advanced behavior", () => {
	test("child of child (grandchild) accumulates meta", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const root = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			meta: { root: true },
			batchSize: 999,
			flushInterval: 60000,
		});

		const child = root.child({ childKey: "c1" });
		const grandchild = child.child({ grandKey: "g1" });
		grandchild.info("grandchild-msg");

		await grandchild.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.meta!.root).toBe(true);
		expect(record.meta!.childKey).toBe("c1");
		expect(record.meta!.grandKey).toBe("g1");

		await root.destroy();
		server.stop();
	});

	test("logger without URL creates no transport (console only)", () => {
		const log = createLogger({ console: false });
		// Should not throw on any operations
		log.info("no-transport");
		log.warn("still fine");
		log.error(new Error("no transport error"));
	});

	test("Error with extra meta merges all fields", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			meta: { env: "test" },
			batchSize: 999,
			flushInterval: 60000,
		});

		const err = new Error("test err");
		log.error(err, { requestId: "req-123" });
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.meta!.env).toBe("test");
		expect(record.meta!.error).toBe("test err");
		expect(record.meta!.name).toBe("Error");
		expect(record.meta!.requestId).toBe("req-123");

		await log.destroy();
		server.stop();
	});

	test("trace level logger sends all messages", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			level: "trace",
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.trace("t");
		log.debug("d");
		log.info("i");
		log.warn("w");
		log.error("e");
		log.fatal("f");

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const messages = received.flat().map((r) => r.message);
		expect(messages).toContain("t");
		expect(messages).toContain("d");
		expect(messages).toContain("i");
		expect(messages).toContain("w");
		expect(messages).toContain("e");
		expect(messages).toContain("f");
		expect(messages.length).toBe(6);

		await log.destroy();
		server.stop();
	});

	test("fatal level logger only sends fatal", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			level: "fatal",
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.trace("nope");
		log.debug("nope");
		log.info("nope");
		log.warn("nope");
		log.error("nope");
		log.fatal("yes");

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const messages = received.flat().map((r) => r.message);
		expect(messages).toEqual(["yes"]);

		await log.destroy();
		server.stop();
	});

	test("log records include host, pid, and timestamp", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			service: "test-svc",
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.info("metadata-check");
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.host).toBeDefined();
		expect(typeof record.host).toBe("string");
		expect(record.pid).toBeDefined();
		expect(typeof record.pid).toBe("number");
		expect(record.timestamp).toBeDefined();
		expect(record.timestamp).toContain("T");
		expect(record.service).toBe("test-svc");

		await log.destroy();
		server.stop();
	});

	test("destroy flushes pending logs before destroying transport", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.info("flush-on-destroy");
		await log.destroy();
		await new Promise((r) => setTimeout(r, 200));

		const messages = received.flat().map((r) => r.message);
		expect(messages).toContain("flush-on-destroy");

		server.stop();
	});
});

describe("Console Formatter", () => {
	test("formatLogRecord produces colored output", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "User logged in",
			service: "auth",
			meta: { userId: 123 },
		};
		const output = formatLogRecord(record);
		expect(output).toContain("User logged in");
		expect(output).toContain("14:32:05.123");
	});

	test("formatLogRecord without meta", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "error",
			message: "Something broke",
		};
		const output = formatLogRecord(record);
		expect(output).toContain("Something broke");
	});

	test("formatLogRecord with trace_id", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "traced request",
			trace_id: "abc-123-def",
		};
		const output = formatLogRecord(record);
		expect(output).toContain("traced request");
	});

	test("formatLogRecord skips empty meta", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "clean log",
			meta: {},
		};
		const output = formatLogRecord(record);
		expect(output).not.toContain("{}");
	});

	test("formatLogRecord shows project only", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "proj log",
			project: "my-app",
		};
		const output = formatLogRecord(record);
		expect(output).toContain("my-app");
	});

	test("formatLogRecord shows branch only", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "branch log",
			branch: "feat-x",
		};
		const output = formatLogRecord(record);
		expect(output).toContain("feat-x");
	});

	test("formatLogRecord shows project@branch", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "both log",
			project: "my-app",
			branch: "main",
		};
		const output = formatLogRecord(record);
		expect(output).toContain("my-app@main");
	});

	test("formatLogRecord without project or branch has no bracket prefix", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "no proj",
		};
		const output = formatLogRecord(record);
		const stripped = output.replace(/\x1b\[[0-9;]*m/g, "");
		expect(stripped).not.toContain("[");
		expect(stripped).not.toContain("@");
	});

	test("formatLogRecord with all log levels produces output", () => {
		for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
			const record: LogRecord = {
				timestamp: "2024-01-15T14:32:05.123Z",
				level,
				message: `${level} test`,
			};
			const output = formatLogRecord(record);
			expect(output).toContain(`${level} test`);
			expect(output).toContain(level.toUpperCase());
		}
	});
});

describe("CLI shared utilities", () => {
	describe("resolveAuth", () => {
		test("returns explicit value when provided", () => {
			expect(resolveAuth("user:pass")).toBe("user:pass");
		});

		test("returns undefined when no explicit and no env", () => {
			const orig = process.env.RELOG_AUTH;
			delete process.env.RELOG_AUTH;
			expect(resolveAuth()).toBeUndefined();
			if (orig) process.env.RELOG_AUTH = orig;
		});

		test("explicit takes precedence over env", () => {
			const orig = process.env.RELOG_AUTH;
			process.env.RELOG_AUTH = "env:pass";
			expect(resolveAuth("explicit:pass")).toBe("explicit:pass");
			if (orig) process.env.RELOG_AUTH = orig;
			else delete process.env.RELOG_AUTH;
		});
	});

	describe("resolveAuthHeader", () => {
		test("returns Authorization header when auth provided", () => {
			const headers = resolveAuthHeader("my-api-key");
			expect(headers.Authorization).toBe("Bearer my-api-key");
		});

		test("returns empty object when no auth", () => {
			const orig = process.env.RELOG_AUTH;
			delete process.env.RELOG_AUTH;
			const headers = resolveAuthHeader();
			expect(Object.keys(headers).length).toBe(0);
			if (orig) process.env.RELOG_AUTH = orig;
		});

		test("does not include Content-Type", () => {
			const headers = resolveAuthHeader("user:pass");
			expect(headers["Content-Type"]).toBeUndefined();
		});
	});

	describe("authHeaders", () => {
		test("includes Content-Type and Authorization", () => {
			const headers = authHeaders("user:pass");
			expect(headers["Content-Type"]).toBe("application/json");
			expect(headers.Authorization).toBeDefined();
		});

		test("includes Content-Type even without auth", () => {
			const orig = process.env.RELOG_AUTH;
			delete process.env.RELOG_AUTH;
			const headers = authHeaders();
			expect(headers["Content-Type"]).toBe("application/json");
			expect(headers.Authorization).toBeUndefined();
			if (orig) process.env.RELOG_AUTH = orig;
		});
	});

	describe("buildParams", () => {
		test("builds URLSearchParams from values", () => {
			const params = buildParams({ level: "error", service: "api", limit: 50 });
			expect(params.get("level")).toBe("error");
			expect(params.get("service")).toBe("api");
			expect(params.get("limit")).toBe("50");
		});

		test("skips undefined values", () => {
			const params = buildParams({ level: "info", service: undefined });
			expect(params.get("level")).toBe("info");
			expect(params.has("service")).toBe(false);
		});

		test("returns empty params for all undefined", () => {
			const params = buildParams({ a: undefined, b: undefined });
			expect(params.toString()).toBe("");
		});
	});

	describe("escapeCsv", () => {
		test("returns plain string unchanged", () => {
			expect(escapeCsv("hello")).toBe("hello");
		});

		test("wraps comma-containing strings in quotes", () => {
			expect(escapeCsv("hello,world")).toBe('"hello,world"');
		});

		test("escapes internal double quotes", () => {
			expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
		});

		test("wraps newline-containing strings in quotes", () => {
			expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
		});

		test("handles null and undefined", () => {
			expect(escapeCsv(null)).toBe("");
			expect(escapeCsv(undefined)).toBe("");
		});

		test("converts numbers to string", () => {
			expect(escapeCsv(42)).toBe("42");
		});
	});
});

describe("Logger project and branch", () => {
	test("logger sends project and branch to server", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			project: "test-proj",
			branch: "test-branch",
			batchSize: 999,
			flushInterval: 60000,
		});

		log.info("proj-branch-test");
		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.project).toBe("test-proj");
		expect(record.branch).toBe("test-branch");

		await log.destroy();
		server.stop();
	});

	test("child logger inherits project and branch", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			project: "parent-proj",
			branch: "parent-branch",
			batchSize: 999,
			flushInterval: 60000,
		});

		const child = log.child({ requestId: "req-1" });
		child.info("child-proj-test");
		await child.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.project).toBe("parent-proj");
		expect(record.branch).toBe("parent-branch");

		await log.destroy();
		server.stop();
	});

	test("child logger can override project and branch", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			project: "parent-proj",
			branch: "parent-branch",
			batchSize: 999,
			flushInterval: 60000,
		});

		const child = log.child({ project: "child-proj", branch: "child-branch" });
		child.info("child-override-test");
		await child.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.project).toBe("child-proj");
		expect(record.branch).toBe("child-branch");

		await log.destroy();
		server.stop();
	});
});

describe("EventBuilder (wide events)", () => {
	test("logger.event() returns an EventBuilder", () => {
		const log = createLogger({ console: false });
		const ev = log.event("test_event");
		expect(ev).toBeInstanceOf(EventBuilder);
	});

	test("event emits a single log record with duration_ms and event=true", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		const ev = log.event("http_request");
		ev.set("method", "GET");
		ev.set("path", "/api/users");
		await new Promise((r) => setTimeout(r, 10));
		ev.end();

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const records = received.flat();
		expect(records.length).toBe(1);

		const record = records[0]!;
		expect(record.message).toBe("http_request");
		expect(record.level).toBe("info");
		expect(record.meta!.method).toBe("GET");
		expect(record.meta!.path).toBe("/api/users");
		expect(record.meta!.event).toBe(true);
		expect(typeof record.meta!.duration_ms).toBe("number");
		expect(record.meta!.duration_ms).toBeGreaterThanOrEqual(0);

		await log.destroy();
		server.stop();
	});

	test("event.set() supports bulk object assignment", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.event("bulk_test").set({ user_id: "usr_1", org_id: "org_1", plan: "pro" }).end();

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.meta!.user_id).toBe("usr_1");
		expect(record.meta!.org_id).toBe("org_1");
		expect(record.meta!.plan).toBe("pro");

		await log.destroy();
		server.stop();
	});

	test("event.error() records error details and escalates level", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		const ev = log.event("payment");
		ev.set("amount", 99.99);
		ev.error(new TypeError("Card declined"));
		ev.end();

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.level).toBe("error");
		expect(record.meta!.error).toBe("Card declined");
		expect(record.meta!.error_name).toBe("TypeError");
		expect(typeof record.meta!.error_stack).toBe("string");
		expect(record.meta!.amount).toBe(99.99);

		await log.destroy();
		server.stop();
	});

	test("event.warn() escalates level to warn", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		log.event("slow_query").set("query", "SELECT * FROM users").warn("Query took too long").end();

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.level).toBe("warn");
		expect(record.meta!.warning).toBe("Query took too long");

		await log.destroy();
		server.stop();
	});

	test("level escalation: error beats warn, never downgrades", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		const ev = log.event("escalation_test");
		ev.warn("something iffy");
		ev.error(new Error("something broke"));
		ev.warn("another warning"); // should NOT downgrade from error
		ev.end();

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		expect(received.flat()[0]!.level).toBe("error");

		await log.destroy();
		server.stop();
	});

	test("double end() is a no-op", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			batchSize: 999,
			flushInterval: 60000,
		});

		const ev = log.event("idempotent");
		ev.set("key", "val");
		ev.end();
		ev.end(); // second call should be ignored

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		expect(received.flat().length).toBe(1);

		await log.destroy();
		server.stop();
	});

	test("event inherits logger bound meta", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			meta: { env: "test", region: "us-east" },
			batchSize: 999,
			flushInterval: 60000,
		});

		log.event("inherit_test").set("extra", true).end();

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.meta!.env).toBe("test");
		expect(record.meta!.region).toBe("us-east");
		expect(record.meta!.extra).toBe(true);

		await log.destroy();
		server.stop();
	});

	test("child logger event inherits parent + child meta", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			meta: { env: "test" },
			batchSize: 999,
			flushInterval: 60000,
		});

		const child = log.child({ requestId: "req-1" });
		child.event("child_event").set("action", "checkout").end();

		await child.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.meta!.env).toBe("test");
		expect(record.meta!.requestId).toBe("req-1");
		expect(record.meta!.action).toBe("checkout");

		await log.destroy();
		server.stop();
	});

	test("event() with initial meta merges with bound meta", async () => {
		const received: LogRecord[][] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = (await req.json()) as LogRecord[];
				received.push(body);
				return Response.json({ ok: true });
			},
		});

		const log = createLogger({
			url: `http://localhost:${server.port}`,
			console: false,
			meta: { env: "test" },
			batchSize: 999,
			flushInterval: 60000,
		});

		log.event("init_meta", { method: "POST" }).set("path", "/api").end();

		await log.flush();
		await new Promise((r) => setTimeout(r, 200));

		const record = received.flat()[0]!;
		expect(record.meta!.env).toBe("test");
		expect(record.meta!.method).toBe("POST");
		expect(record.meta!.path).toBe("/api");

		await log.destroy();
		server.stop();
	});

	test("chaining: set returns this for fluent API", () => {
		const log = createLogger({ console: false });
		const ev = log.event("chain_test");
		const result = ev.set("a", 1).set("b", 2).set({ c: 3 });
		expect(result).toBe(ev);
	});

	test("formatLogRecord shows duration for wide events", () => {
		const record: LogRecord = {
			timestamp: "2024-01-15T14:32:05.123Z",
			level: "info",
			message: "http_request",
			meta: { method: "GET", path: "/api", duration_ms: 142.5, event: true },
		};
		const output = formatLogRecord(record);
		expect(output).toContain("http_request");
		expect(output).toContain("142.5ms");
	});
});

describe("captureConsole", () => {
	afterEach(() => {
		// Always restore so other tests aren't affected
		console.log = originalConsole.log;
		console.info = originalConsole.info;
		console.warn = originalConsole.warn;
		console.error = originalConsole.error;
		console.debug = originalConsole.debug;
	});

	test("console.log routes through logger.info", () => {
		const captured: { level: string; message: string; meta?: Record<string, unknown> }[] = [];
		const log = createLogger({ console: false });
		// Spy on the internal log by overriding info
		const origInfo = log.info.bind(log);
		log.info = (msg: string | Error, meta?: Record<string, unknown>) => {
			captured.push({ level: "info", message: String(msg), meta });
			origInfo(msg, meta);
		};
		log.captureConsole();

		console.log("hello world");
		expect(captured).toHaveLength(1);
		expect(captured[0]!.message).toBe("hello world");
		expect(captured[0]!.meta?.source).toBe("console");
	});

	test("console.warn routes through logger.warn", () => {
		const captured: { level: string; message: string }[] = [];
		const log = createLogger({ console: false });
		const origWarn = log.warn.bind(log);
		log.warn = (msg: string | Error, meta?: Record<string, unknown>) => {
			captured.push({ level: "warn", message: String(msg) });
			origWarn(msg, meta);
		};
		log.captureConsole();

		console.warn("watch out");
		expect(captured).toHaveLength(1);
		expect(captured[0]!.message).toBe("watch out");
	});

	test("console.error routes through logger.error", () => {
		const captured: { level: string; message: string }[] = [];
		const log = createLogger({ console: false });
		const origError = log.error.bind(log);
		log.error = (msg: string | Error, meta?: Record<string, unknown>) => {
			captured.push({ level: "error", message: String(msg) });
			origError(msg, meta);
		};
		log.captureConsole();

		console.error("something broke");
		expect(captured).toHaveLength(1);
		expect(captured[0]!.message).toBe("something broke");
	});

	test("console.debug routes through logger.debug", () => {
		const captured: { level: string; message: string }[] = [];
		const log = createLogger({ console: false, level: "debug" });
		const origDebug = log.debug.bind(log);
		log.debug = (msg: string | Error, meta?: Record<string, unknown>) => {
			captured.push({ level: "debug", message: String(msg) });
			origDebug(msg, meta);
		};
		log.captureConsole();

		console.debug("dbg info");
		expect(captured).toHaveLength(1);
		expect(captured[0]!.message).toBe("dbg info");
	});

	test("console.log with multiple args uses util.format", () => {
		const captured: string[] = [];
		const log = createLogger({ console: false });
		const origInfo = log.info.bind(log);
		log.info = (msg: string | Error, meta?: Record<string, unknown>) => {
			captured.push(String(msg));
			origInfo(msg, meta);
		};
		log.captureConsole();

		console.log("count: %d, name: %s", 42, "tim");
		expect(captured[0]).toBe("count: 42, name: tim");
	});

	test("restoreConsole brings back original methods", () => {
		const log = createLogger({ console: false });
		const savedLog = console.log;
		log.captureConsole();

		expect(console.log).not.toBe(savedLog);
		log.restoreConsole();
		expect(console.log).toBe(originalConsole.log);
	});

	test("no infinite recursion when console is enabled", () => {
		const log = createLogger({ console: true });
		log.captureConsole();

		// This would stack overflow if printLogRecord used the overridden console
		console.log("recursion guard");
		console.warn("warn recursion");
		console.error("error recursion");

		log.restoreConsole();
	});
});
