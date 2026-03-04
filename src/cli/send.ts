import { type Command, command, number, string } from "@drizzle-team/brocli";
import { authHeaders } from "./shared.ts";

export const sendCommand: Command = command({
	name: "send",
	desc: "Send a log entry to the server",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		level: string().desc("Log level (trace, debug, info, warn, error, fatal)").default("info"),
		message: string("message").desc("Log message").required(),
		service: string().desc("Service name"),
		project: string().desc("Project name"),
		branch: string().desc("Git branch"),
		meta: string().desc("JSON metadata object"),
		host: string().desc("Hostname"),
		pid: number().desc("Process ID"),
		traceId: string("trace-id").desc("Trace ID"),
		spanId: string("span-id").desc("Span ID"),
		auth: string().desc("Basic auth (user:pass). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const entry: Record<string, unknown> = {
			level: opts.level,
			message: opts.message,
		};

		if (opts.service) entry.service = opts.service;
		if (opts.project) entry.project = opts.project;
		if (opts.branch) entry.branch = opts.branch;
		if (opts.host) entry.host = opts.host;
		if (opts.pid) entry.pid = opts.pid;
		if (opts.traceId) entry.trace_id = opts.traceId;
		if (opts.spanId) entry.span_id = opts.spanId;

		if (opts.meta) {
			try {
				entry.meta = JSON.parse(opts.meta);
			} catch {
				console.error("Invalid --meta JSON");
				process.exit(1);
			}
		}

		const response = await fetch(`${opts.url}/ingest`, {
			method: "POST",
			headers: authHeaders(opts.auth),
			body: JSON.stringify(entry),
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string };
			console.error(`Send failed: ${body.error ?? response.status}`);
			process.exit(1);
		}

		console.log(`Sent: [${opts.level}] ${opts.message}`);
	},
});
