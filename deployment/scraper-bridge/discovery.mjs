// A failed metadata lookup is not a completed empty search. Evict it so the
// web client's existing bounded retries can start discovery again.
export function sourceSnapshot(entry, evict) {
	if (entry.failed && entry.streams.length === 0) {
		evict();
		throw Object.assign(new Error("Source discovery failed"), { status: 502 });
	}
	return {
		streams: entry.streams.slice(),
		behaviorHints: { searchPending: !entry.done },
	};
}
