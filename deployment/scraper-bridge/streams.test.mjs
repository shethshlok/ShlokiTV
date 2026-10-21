import assert from "node:assert/strict";
import { test } from "node:test";
import { providerHosts } from "./provider-hosts.mjs";
import { validateTarget } from "./providerProxy.mjs";
import { normalizeSource, sourceKey } from "./streams.mjs";

const scraper = { id: "fixture", name: "Fixture provider" };
const hash = "0123456789abcdef0123456789abcdef01234567";

test("preserves native magnet results for the existing external torrent handoff", async () => {
	const stream = await normalizeSource(
		{
			url: `magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=Monk.S01E01E02`,
			name: "Torrentio | 1080p",
			title: "Monk S1 E1",
			fileIdx: 2,
		},
		scraper,
		() => {
			throw new Error("A magnet must never trigger an HTTP/DNS probe");
		},
	);
	assert.equal(stream.infoHash, hash);
	assert.equal(stream.url, undefined);
	assert.equal(stream.fileIdx, 2);
	assert.equal(stream.title, "Monk S1 E1");
	assert.equal(stream.behaviorHints.notWebReady, true);
	assert.notEqual(sourceKey(stream), sourceKey({ ...stream, fileIdx: 3 }));
});

test("accepts infoHash-only and base32 native torrent results without conflating files", async () => {
	const byHash = await normalizeSource({ infoHash: hash }, scraper);
	const byMagnet = await normalizeSource(
		{ url: `magnet:?xt=urn:btih:${hash}` },
		scraper,
	);
	assert.equal(sourceKey(byHash), sourceKey(byMagnet));
	const base32 = await normalizeSource(
		{ url: `magnet:?xt=urn:btih:${"A".repeat(32)}` },
		scraper,
	);
	assert.equal(base32.infoHash, "a".repeat(32));
});

test("rejects malformed magnets, unsafe schemes and insecure/private HTTP destinations", async () => {
	await Promise.all(
		[
			"magnet:?xt=urn:btih:invalid",
			"magnet:?xt=urn:btmh:invalid",
			"javascript:alert(1)",
			"file:///etc/passwd",
			"http://8.8.8.8/stream.mp4",
			"https://127.0.0.1/stream.mp4",
			"https://10.0.0.1/stream.mp4",
			"https://user:password@8.8.8.8/stream.mp4",
		].map(async (url) => {
			assert.equal(await normalizeSource({ url }, scraper), null, url);
		}),
	);
	assert.equal(await normalizeSource({ infoHash: "invalid" }, scraper), null);
	assert.equal(await normalizeSource(null, scraper), null);
});

test("preserves direct release metadata and request headers without marking it as a torrent", async () => {
	const result = {
		url: "https://8.8.8.8/stream.mp4",
		title: "Monk S01E01E02",
		filename: "Monk.S01E01E02.mp4",
		size: 123_456,
		description: "Combined pilot",
		headers: { Referer: "https://example.com/" },
	};
	const stream = await normalizeSource(result, scraper);
	assert.equal(stream.url, result.url);
	assert.equal(stream.infoHash, undefined);
	assert.equal(stream.behaviorHints.filename, result.filename);
	assert.equal(stream.behaviorHints.videoSize, result.size);
	assert.deepEqual(stream.behaviorHints.proxyHeaders.request, result.headers);
	assert.equal(stream.description, result.description);
});

test("approves reviewed provider hosts while preserving exact HTTPS destination checks", () => {
	const hosts = providerHosts(" EXTRA.EXAMPLE , extra.example ");
	for (const host of [
		"torrentio.strem.fun",
		"api.movix.cash",
		"api.purstream.club",
		"extra.example",
	]) {
		assert.equal(
			validateTarget(`https://${host}/stream`, hosts).hostname,
			host,
		);
	}
	for (const url of [
		"https://unreviewed.example/stream",
		"https://api.movix.cash.attacker.example/stream",
		"https://api.movix.cash:8443/stream",
		"https://user:password@api.movix.cash/stream",
		"http://api.movix.cash/stream",
		"https://127.0.0.1/stream",
	]) {
		assert.throws(
			() => validateTarget(url, hosts),
			/Destination is not allowed/,
		);
	}
});
