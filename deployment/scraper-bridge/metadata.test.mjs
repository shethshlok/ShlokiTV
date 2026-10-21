import assert from "node:assert/strict";
import { test } from "node:test";
import { lookup } from "./metadata.mjs";

test("preserves season and episode for IMDb, bare TMDB and namespaced TMDB series", async () => {
	const fetcher = (url) => {
		assert.equal(
			url,
			"https://v3-cinemeta.strem.io/meta/series/tt0312172.json",
		);
		return Response.json({ meta: { moviedb_id: 1695 } });
	};
	const expected = { tmdbId: "1695", mediaType: "tv", season: 2, episode: 5 };
	assert.deepEqual(await lookup("series", "tt0312172:2:5", fetcher), expected);
	assert.deepEqual(await lookup("series", "tmdb:1695:2:5", fetcher), expected);
	assert.deepEqual(await lookup("series", "1695:2:5", fetcher), expected);
	assert.deepEqual(await lookup("series", "tmdb:1695:0:1", fetcher), {
		...expected,
		season: 0,
		episode: 1,
	});
});

test("uses episode-only ids and movie ids consistently with the web player", async () => {
	assert.deepEqual(await lookup("series", "tmdb:1695:5"), {
		tmdbId: "1695",
		mediaType: "tv",
		season: 1,
		episode: 5,
	});
	assert.deepEqual(await lookup("series", "tmdb:1695"), {
		tmdbId: "1695",
		mediaType: "tv",
		season: 1,
		episode: 1,
	});
	assert.deepEqual(await lookup("movie", "tmdb:603"), {
		tmdbId: "603",
		mediaType: "movie",
		season: undefined,
		episode: undefined,
	});
});

test("reports invalid ids and metadata failures instead of guessing another episode", async () => {
	await assert.rejects(lookup("series", "tmdb:1695:2:NaN"), /Invalid episode/);
	await assert.rejects(lookup("series", "tmdb:1695:-1:1"), /Invalid episode/);
	await assert.rejects(lookup("movie", "tmdb:tt1"), /Unsupported/);
	await assert.rejects(
		lookup("movie", "tt1", () => new Response("", { status: 503 })),
		/Metadata unavailable/,
	);
	await assert.rejects(
		lookup("movie", "tt1", () => Response.json({ meta: {} })),
		/TMDB ID unavailable/,
	);
});
