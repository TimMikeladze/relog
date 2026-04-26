import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

interface Props {
	view: string;
	children: ReactNode;
}

interface State {
	error: Error | null;
}

/**
 * Per-view crash isolator. A render error in one view (Explore, Traces,
 * Query, Dashboard) used to white-screen the whole app because React
 * unmounts everything above the boundary. With this in place, the user
 * can switch to another view, retry, or copy the error message.
 *
 * `view` is part of state-reset key in App so navigating to a different
 * view automatically clears a stuck error without forcing a full reload.
 */
export class ViewErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(`[relog] view "${this.props.view}" crashed:`, error, info.componentStack);
	}

	private retry = () => {
		this.setState({ error: null });
	};

	render(): ReactNode {
		if (!this.state.error) return this.props.children;

		return (
			<div className="flex h-full w-full items-center justify-center p-6">
				<div className="flex max-w-lg flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm">
					<div className="flex items-center gap-2 font-semibold text-destructive">
						<AlertCircle className="h-4 w-4" />
						<span>Something went wrong in “{this.props.view}”</span>
					</div>
					<div className="text-muted-foreground">
						The other views still work. Try retrying, or switch tabs and come back.
					</div>
					<pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-[11px] text-foreground">
						{this.state.error.message}
					</pre>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={this.retry}
							className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
						>
							<RotateCcw className="h-3 w-3" /> Retry
						</button>
					</div>
				</div>
			</div>
		);
	}
}
