import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceSnapshot } from "./discovery.mjs";

test("evicts a failed lookup instead of caching a false empty result for five minutes", () => {
	const failed = { streams: [], done: true, failed: true };
	const cache = new Map([
		["failed", failed],
		["other", { streams: [], done: false }],
	]);
	assert.throws(() => sourceSnapshot(failed, () => cache.delete("failed")), {
		message: "Source discovery failed",
		status: 502,
	});
	assert.equal(cache.has("failed"), false);
	assert.equal(cache.has("other"), true);
});

test("distinguishes pending snapshots from a successful completed empty search", () => {
	const entry = { streams: [], done: false };
	const evict = () => {
		throw new Error("Successful searches must not be evicted");
	};
	assert.equal(sourceSnapshot(entry, evict).behaviorHints.searchPending, true);
	entry.done = true;
	assert.deepEqual(sourceSnapshot(entry, evict), {
		streams: [],
		behaviorHints: { searchPending: false },
	});
});

test("keeps available sources when a later discovery step fails", () => {
	const entry = {
		streams: [{ url: "https://example.com/video.mp4" }],
		done: true,
		failed: true,
	};
	const result = sourceSnapshot(entry, () => {
		throw new Error("Available sources must be kept");
	});
	assert.deepEqual(result.streams, entry.streams);
	assert.notEqual(result.streams, entry.streams);
});
