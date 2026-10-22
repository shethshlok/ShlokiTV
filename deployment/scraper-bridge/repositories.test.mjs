import assert from "node:assert/strict";
import { test } from "node:test";
import { collectRepositories } from "./repositories.mjs";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const row = (name) => ({
	url: `https://raw.githubusercontent.com/test/${name}/main/manifest.json`,
});
const manifest = (id) =>
	JSON.stringify({ scrapers: [{ id, filename: `${id}.js` }] });
const turn = () => new Promise((resolve) => setImmediate(resolve));

test("starts a working repository without waiting for a stalled repository", async () => {
	const slow = deferred();
	const calls = [];
	const search = collectRepositories(
		[row("slow"), row("fast")],
		Promise.resolve({ mediaType: "movie" }),
		async (url) => (url.includes("/slow/") ? slow.promise : manifest("castle")),
		(scraper) => {
			calls.push(scraper.id);
			return Promise.resolve();
		},
	);
	await turn();
	assert.deepEqual(calls, ["castle"]);
	slow.reject(new Error("Download timed out"));
	assert.equal(await search, 1);
});

test("downloads manifests during metadata lookup, but runs only once metadata is ready", async () => {
	const metadata = deferred();
	const downloads = [];
	const calls = [];
	const search = collectRepositories(
		[row("fast")],
		metadata.promise,
		(url) => {
			downloads.push(url);
			return Promise.resolve(manifest("castle"));
		},
		(_scraper, args) => {
			calls.push(args);
			return Promise.resolve();
		},
	);
	await turn();
	assert.equal(downloads.length, 1);
	assert.deepEqual(calls, []);
	const args = { mediaType: "tv", season: 2, episode: 4 };
	metadata.resolve(args);
	assert.equal(await search, 1);
	assert.deepEqual(calls, [args]);
});

test("preserves provider priority, enabled flags, type filters and failure isolation", async () => {
	const calls = [];
	const search = collectRepositories(
		[row("fast"), row("broken")],
		Promise.resolve({ mediaType: "movie" }),
		async (url) =>
			url.includes("/broken/")
				? "invalid json"
				: JSON.stringify({
						scrapers: [
							{ id: "other", filename: "other.js" },
							{ id: "disabled", enabled: false, filename: "disabled.js" },
							{ id: "tv", supportedTypes: ["tv"], filename: "tv.js" },
							{ id: "movieblast", filename: "movieblast.js" },
							{ id: "castle", filename: "castle.js" },
						],
					}),
		(scraper) => {
			calls.push(scraper.id);
			assert.equal(
				scraper.codeUrl,
				new URL(`${scraper.id}.js`, row("fast").url).href,
			);
			return scraper.id === "castle"
				? Promise.reject(new Error("Provider failed"))
				: Promise.resolve();
		},
	);
	assert.equal(await search, 3);
	assert.deepEqual(calls, ["castle", "movieblast", "other"]);
});

test("propagates failed metadata for retry even with no repositories", async () => {
	await assert.rejects(
		collectRepositories(
			[],
			Promise.reject(new Error("Metadata unavailable")),
			() => Promise.resolve("{}"),
			() => Promise.resolve(),
		),
		/Metadata unavailable/,
	);
});
