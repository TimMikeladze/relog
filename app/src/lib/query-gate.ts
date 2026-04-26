/**
 * Bounded-concurrency gate shared by every widget's `/query` call. Without
 * it, an N-widget dashboard fires N parallel DuckDB queries on every
 * auto-refresh tick. On a slow box those stack up faster than they
 * complete and starve out the UI. The cap is high enough that a normal
 * tick still feels parallel, low enough that a slow query can't drown
 * everything else.
 */
const MAX_CONCURRENT = 4;

let active = 0;
const queue: Array<() => void> = [];

function next(): void {
	if (active >= MAX_CONCURRENT) return;
	const fn = queue.shift();
	if (!fn) return;
	active++;
	fn();
}

export function withQueryGate<T>(fn: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const run = () => {
			fn()
				.then(resolve, reject)
				.finally(() => {
					active--;
					next();
				});
		};
		queue.push(run);
		next();
	});
}
