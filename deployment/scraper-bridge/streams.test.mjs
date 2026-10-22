import assert from "node:assert/strict";
import { test } from "node:test";
import { providerHosts } from "./provider-hosts.mjs";
import { validateTarget } from "./providerProxy.mjs";
import { collectSources, normalizeSource } from "./streams.mjs";

const scraper = { id: "fixture", name: "Fixture provider" };
const hash = "0123456789abcdef0123456789abcdef01234567";

test("publishes usable links before another source's DNS check finishes", async () => {
	let finish;
	const slow = new Promise((resolve) => {
		finish = resolve;
	});
	const streams = [];
	const fastUrl = "https://fast.example/video.mp4";
	const search = collectSources(
		[
			{ url: "https://slow.example/video.mp4" },
			{ url: fastUrl },
			{ url: fastUrl },
			{ url: `magnet:?xt=urn:btih:${hash}` },
		],
		scraper,
		streams,
		(url) => (url.includes("slow.example") ? slow : Promise.resolve(true)),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(
		streams.map((stream) => stream.url),
		[fastUrl],
	);
	finish(false);
	await search;
	assert.deepEqual(
		streams.map((stream) => stream.url),
		[fastUrl],
	);
});

test("adds later validated links once without replacing existing source positions", async () => {
	let finish;
	const slow = new Promise((resolve) => {
		finish = resolve;
	});
	const firstUrl = "https://first.example/video.mp4";
	const laterUrl = "https://later.example/video.mp4";
	const existing = { url: firstUrl, name: "Existing choice" };
	const streams = [existing];
	const search = collectSources(
		[{ url: firstUrl }, { url: laterUrl }, { url: laterUrl }],
		scraper,
		streams,
		(url) => (url === laterUrl ? slow : Promise.resolve(true)),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(streams, [existing]);
	finish(true);
	await search;
	assert.equal(streams[0], existing);
	assert.deepEqual(
		streams.map((stream) => stream.url),
		[firstUrl, laterUrl],
	);
});

test("excludes native torrent results that require a client torrent app", async () => {
	await Promise.all(
		[
			{ url: `magnet:?xt=urn:btih:${hash}` },
			{ infoHash: hash },
			{ url: `magnet:?xt=urn:btih:${"A".repeat(32)}` },
		].map(async (result) => {
			assert.equal(
				await normalizeSource(result, scraper, () => {
					throw new Error("Torrent links must not trigger HTTP/DNS probes");
				}),
				null,
			);
		}),
	);
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
