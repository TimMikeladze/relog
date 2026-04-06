import type { IngestPayload } from "../../types.ts";
import type { PullBatch, SourceAdapter } from "../types.ts";

const RUNS_PER_PAGE = 30;
const MAX_PAGES = 10;
const FETCH_TIMEOUT_MS = 30_000;
const JOB_FETCH_CONCURRENCY = 5;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

interface WorkflowRun {
	id: number;
	name: string;
	head_branch: string;
	head_sha: string;
	conclusion: string | null;
	status: string;
	created_at: string;
	updated_at: string;
	html_url: string;
	repository: { full_name: string };
}

interface WorkflowJob {
	id: number;
	name: string;
	conclusion: string | null;
	started_at: string;
	completed_at: string | null;
	steps: WorkflowStep[];
}

interface WorkflowStep {
	name: string;
	status: string;
	conclusion: string | null;
	number: number;
	started_at: string | null;
	completed_at: string | null;
}

/**
 * Cursor format: "TIMESTAMP|RUN_ID,RUN_ID,..."
 * - TIMESTAMP: ISO 8601 of the newest run's created_at (used for API filtering)
 * - RUN_IDs: recently processed run IDs at the boundary timestamp (used for client-side dedup)
 */
interface ParsedCursor {
	timestamp: string;
	seenIds: Set<number>;
}

function parseCursor(raw: string | null): ParsedCursor | null {
	if (!raw) return null;

	const pipeIdx = raw.indexOf("|");
	if (pipeIdx === -1) return null;

	const timestamp = raw.slice(0, pipeIdx);
	if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;

	const idsPart = raw.slice(pipeIdx + 1);
	const seenIds = new Set<number>();
	if (idsPart) {
		for (const s of idsPart.split(",")) {
			const n = Number.parseInt(s, 10);
			if (!Number.isNaN(n)) seenIds.add(n);
		}
	}

	return { timestamp, seenIds };
}

function buildCursor(timestamp: string, seenIds: Set<number>): string {
	return `${timestamp}|${[...seenIds].join(",")}`;
}

export class GitHubRateLimitError extends Error {
	retryAfter: number;
	constructor(retryAfter: number) {
		super(`GitHub API rate limited. Retry after ${retryAfter}s`);
		this.name = "GitHubRateLimitError";
		this.retryAfter = retryAfter;
	}
}

async function githubFetch(path: string, token: string): Promise<Response> {
	const res = await fetch(`https://api.github.com${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});

	if (res.status === 403 || res.status === 429) {
		const retryHeader = res.headers.get("Retry-After");
		const retryAfter = retryHeader ? Number.parseInt(retryHeader, 10) : 60;
		throw new GitHubRateLimitError(Number.isNaN(retryAfter) ? 60 : retryAfter);
	}

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`GitHub API ${res.status}: ${path} — ${body}`);
	}
	return res;
}

/**
 * Fetch completed workflow runs with pagination.
 * Returns runs in ascending order (oldest first) for incremental processing.
 */
async function fetchNewRuns(
	repo: string,
	token: string,
	cursor: ParsedCursor | null,
	branch?: string,
): Promise<WorkflowRun[]> {
	const allRuns: WorkflowRun[] = [];

	for (let page = 1; page <= MAX_PAGES; page++) {
		let path = `/repos/${repo}/actions/runs?status=completed&per_page=${RUNS_PER_PAGE}&page=${page}`;
		if (branch) path += `&branch=${encodeURIComponent(branch)}`;
		if (cursor) path += `&created=>=${encodeURIComponent(cursor.timestamp)}`;

		const res = await githubFetch(path, token);
		const data = (await res.json()) as { workflow_runs: WorkflowRun[] };

		if (data.workflow_runs.length === 0) break;
		allRuns.push(...data.workflow_runs);

		// Stop if we got less than a full page (no more results)
		if (data.workflow_runs.length < RUNS_PER_PAGE) break;
	}

	// Dedup: skip runs we already processed in the previous poll
	let runs = allRuns;
	if (cursor) {
		runs = runs.filter((r) => !cursor.seenIds.has(r.id));
	}

	// Oldest first so we process in chronological order
	runs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

	return runs;
}

async function fetchJobs(repo: string, runId: number, token: string): Promise<WorkflowJob[]> {
	const allJobs: WorkflowJob[] = [];
	for (let page = 1; page <= 5; page++) {
		const res = await githubFetch(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`, token);
		const data = (await res.json()) as { jobs: WorkflowJob[] };
		allJobs.push(...data.jobs);
		if (data.jobs.length < 100) break;
	}
	return allJobs;
}

/**
 * Convert a workflow run + its jobs into IngestPayload log entries.
 * One log entry per step + one summary per job.
 */
function runToLogs(run: WorkflowRun, jobs: WorkflowJob[]): IngestPayload[] {
	const logs: IngestPayload[] = [];
	const repo = run.repository.full_name;

	for (const job of jobs) {
		for (const step of job.steps) {
			const failed = step.conclusion === "failure";
			const skipped = step.conclusion === "skipped";

			logs.push({
				timestamp: step.started_at ?? job.started_at,
				level: failed ? "error" : skipped ? "debug" : "info",
				message: `${step.name} — ${step.conclusion ?? step.status}`,
				service: job.name,
				project: repo,
				branch: run.head_branch,
				version: run.head_sha.slice(0, 8),
				trace_id: `gha:${run.id}`,
				meta: {
					source: "github-actions",
					workflow: run.name,
					run_id: run.id,
					job_id: job.id,
					step_number: step.number,
					step_name: step.name,
					conclusion: step.conclusion,
					run_url: run.html_url,
				},
			});
		}

		const jobFailed = job.conclusion === "failure";
		logs.push({
			timestamp: job.completed_at ?? job.started_at,
			level: jobFailed ? "error" : "info",
			message: `Job "${job.name}" — ${job.conclusion ?? "in_progress"}`,
			service: job.name,
			project: repo,
			branch: run.head_branch,
			version: run.head_sha.slice(0, 8),
			trace_id: `gha:${run.id}`,
			meta: {
				source: "github-actions",
				workflow: run.name,
				run_id: run.id,
				job_id: job.id,
				conclusion: job.conclusion,
				run_url: run.html_url,
				is_summary: true,
			},
		});
	}

	return logs;
}

// Exported for testing
export { parseCursor, buildCursor, runToLogs };
export type { ParsedCursor, WorkflowRun, WorkflowJob, WorkflowStep };

export const githubActionsAdapter: SourceAdapter = {
	name: "github-actions",

	async *pull(config: Record<string, unknown>, cursor: string | null): AsyncIterable<PullBatch> {
		const repo = config.repo as string;
		const token = config.token as string;
		const branch = config.branch as string | undefined;

		if (!repo) throw new Error("github-actions adapter requires 'repo'");
		if (!REPO_RE.test(repo)) throw new Error(`github-actions adapter: invalid repo format '${repo}' (expected 'owner/name')`);
		if (!token) throw new Error("github-actions adapter requires 'token'");

		const parsed = parseCursor(cursor);
		const runs = await fetchNewRuns(repo, token, parsed, branch);

		if (runs.length === 0) return;

		// Fetch jobs concurrently in batches to avoid N+1 API waterfall
		const jobsByRun = new Map<number, WorkflowJob[]>();
		for (let i = 0; i < runs.length; i += JOB_FETCH_CONCURRENCY) {
			const batch = runs.slice(i, i + JOB_FETCH_CONCURRENCY);
			const results = await Promise.all(
				batch.map((run) => fetchJobs(repo, run.id, token)),
			);
			for (let j = 0; j < batch.length; j++) {
				jobsByRun.set(batch[j]!.id, results[j]!);
			}
		}

		let newestTimestamp = parsed?.timestamp ?? runs[0]!.created_at;
		let boundaryIds = new Set<number>(parsed?.seenIds);

		for (const run of runs) {
			const jobs = jobsByRun.get(run.id) ?? [];
			const logs = runToLogs(run, jobs);

			// When timestamp advances, old boundary IDs are no longer needed —
			// the API's created>= filter will exclude them on next poll
			if (run.created_at > newestTimestamp) {
				newestTimestamp = run.created_at;
				boundaryIds = new Set<number>();
			}

			if (run.created_at === newestTimestamp) {
				boundaryIds.add(run.id);
			}

			yield {
				logs,
				cursor: buildCursor(newestTimestamp, boundaryIds),
			};
		}
	},
};
