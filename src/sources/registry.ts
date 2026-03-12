import type { SourceAdapter } from "./types.ts";
import { githubActionsAdapter } from "./adapters/github-actions.ts";

const adapters = new Map<string, SourceAdapter>();

adapters.set(githubActionsAdapter.name, githubActionsAdapter);

export function getAdapter(name: string): SourceAdapter {
	const adapter = adapters.get(name);
	if (!adapter) {
		const available = [...adapters.keys()].join(", ");
		throw new Error(`Unknown source adapter "${name}". Available: ${available}`);
	}
	return adapter;
}
