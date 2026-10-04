import { untrack } from "svelte";

interface SourceQuery {
	readonly current?: {
		pending: boolean;
		streams?: readonly unknown[];
		errors?: readonly unknown[];
	};
	readonly error?: unknown;
	refresh(): Promise<unknown>;
}

// Addon failures are returned inside a successful remote-query response.
// An empty failed response does not establish that no sources exist.
function sourceRequestFailed(query: SourceQuery) {
	return (
		query.error != null ||
		Boolean(
			!query.current?.pending &&
			query.current?.errors?.length &&
			!query.current?.streams?.length,
		)
	);
}

// The drawer and player share a remote query. Coalesce their polling requests.
const refreshing = new WeakMap<SourceQuery, Promise<unknown>>();
function refreshOnce(query: SourceQuery) {
	const existing = refreshing.get(query);
	if (existing) return existing;
	const request = Promise.resolve().then(() => query.refresh()).finally(() => refreshing.delete(query));
	refreshing.set(query, request);
	return request;
}

/** Show an honest loading state until the bridge finishes, with bounded retries. */
export function sourceLoading(get: () => SourceQuery | undefined, key: () => string) {
	let expired = $state(false);
	let retries = $state(0);
	let tick = $state(0);
	let cycle = $state(0);
	let generation = 0;
	let busy = $state(false);

	$effect(() => {
		void key();
		void cycle;
		generation++;
		untrack(() => { expired = false; retries = 0; busy = false; });
		const timer = setTimeout(() => { expired = true; }, 120_000);
		return () => { generation++; clearTimeout(timer); };
	});

	$effect(() => {
		void tick;
		const query = get();
		if (!query || expired || busy) return;
		const failed = sourceRequestFailed(query);
		if (!(query.current?.pending || (failed && retries < 3))) return;
		const currentGeneration = generation;
		const timer = setTimeout(async () => {
			busy = true;
			if (failed) retries++;
			try { await refreshOnce(query); } catch { /* the query exposes the error */ }
			finally {
				if (generation === currentGeneration) { busy = false; tick++; }
			}
		}, 2000);
		return () => clearTimeout(timer);
	});

	return {
		get searching() {
			const query = get();
			return !!query && !expired && (
				busy || (sourceRequestFailed(query)
					? retries < 3
					: !query.current || query.current.pending)
			);
		},
		get failed() {
			const query = get();
			return !!query && sourceRequestFailed(query);
		},
		get expired() { return expired; },
		restart() { cycle++; },
	};
}
