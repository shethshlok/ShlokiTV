import { describe, expect, it } from "vitest";
import { namesRequestedEpisode } from "./episode-match.ts";

describe("namesRequestedEpisode", () => {
	const id = "tt1845307:1:5";

	it("drops other episodes a provider returned from the season folder", () => {
		expect(
			namesRequestedEpisode(id, [
				"DahmerMovies",
				"1080p | 2.8 GB | 2 Broke Girls 2011 S01E01 Pilot Bluray",
			]),
		).toBe(false);
		expect(
			namesRequestedEpisode(id, [
				"2 Broke Girls (2011) - S01E05 - And the '90s Horse Party",
			]),
		).toBe(true);
		expect(
			namesRequestedEpisode(id, [
				"2.Broke.Girls.S01E05.And.the.90s.Horse.Party.1080p.mkv",
			]),
		).toBe(true);
	});

	it("keeps untagged labels, multi-episode files and non-series ids", () => {
		expect(namesRequestedEpisode(id, ["Castle [Shared] - 1080P", null])).toBe(
			true,
		);
		expect(namesRequestedEpisode(id, ["Show.S01E04-E06.1080p.mkv"])).toBe(true);
		expect(namesRequestedEpisode(id, ["Show.S01E04E05.1080p.mkv"])).toBe(true);
		expect(namesRequestedEpisode("tt0111161", ["Movie S01E01"])).toBe(true);
	});

	it("rejects the right episode number in the wrong season", () => {
		expect(namesRequestedEpisode(id, ["Show S02E05 1080p"])).toBe(false);
	});

	it("keeps the requested episode for namespaced ids and rejects other episodes", () => {
		expect(namesRequestedEpisode("tmdb:1695:2:5", ["Monk S02E05"])).toBe(true);
		expect(namesRequestedEpisode("tmdb:1695:2:5", ["Monk S01E05"])).toBe(false);
		expect(namesRequestedEpisode("kitsu:46474:5", ["Show S01E05"])).toBe(true);
		expect(namesRequestedEpisode("kitsu:46474:5", ["Show S01E06"])).toBe(false);
	});
});
