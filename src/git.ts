import { spawnSync } from "node:child_process";
import { basename } from "node:path";

let cachedProject: string | undefined;
let cachedBranch: string | undefined;
let resolved = false;

function resolveGit(): void {
	if (resolved) return;
	resolved = true;

	try {
		const toplevel = spawnSync("git", ["rev-parse", "--show-toplevel"], {
			encoding: "utf-8",
			timeout: 3000,
		});
		if (toplevel.status === 0 && toplevel.stdout) {
			cachedProject = basename(toplevel.stdout.trim());
		}
	} catch {}

	try {
		const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			encoding: "utf-8",
			timeout: 3000,
		});
		if (branch.status === 0 && branch.stdout) {
			cachedBranch = branch.stdout.trim();
		}
	} catch {}
}

export function inferGitProject(): string | undefined {
	if (process.env.RELOG_PROJECT) return process.env.RELOG_PROJECT;
	resolveGit();
	return cachedProject;
}

export function inferGitBranch(): string | undefined {
	if (process.env.RELOG_BRANCH) return process.env.RELOG_BRANCH;
	resolveGit();
	return cachedBranch;
}
