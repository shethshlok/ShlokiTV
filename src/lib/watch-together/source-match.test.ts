import { expect, it } from "vitest";
import type { ResolvedStream } from "#lib/watch/stream-format.js";
import { matchingSource } from "./source-match.js";

it("matches a release across different signed URLs without matching unrelated files", () => {
	const media = {
		type: "movie",
		id: "tt1",
		title: "Movie",
		label: "1080p",
		duration: 100,
		filename: "movie.mkv",
		fileSize: 123_456,
	};
	const wrong = {
		url: "https://host/wrong",
		filename: "other.mkv",
		fileSize: 123_456,
	} as ResolvedStream;
	const same = {
		url: "https://host/own-account-token",
		filename: "movie.mkv",
		fileSize: 123_456,
	} as ResolvedStream;
	expect(matchingSource(media, [wrong, same])).toBe(same);
	expect(
		matchingSource({ ...media, filename: null }, [wrong, same]),
	).toBeNull();
});
