import { expect, it } from "vitest";
import { hasPlaybackData } from "./readiness.js";

it("accepts paused current-frame players with future media but holds empty buffers", () => {
	const buffered = { length: 1, start: () => 0, end: () => 10 };
	expect(hasPlaybackData({ readyState: 2, currentTime: 2, buffered })).toBe(
		true,
	);
	expect(hasPlaybackData({ readyState: 2, currentTime: 9.8, buffered })).toBe(
		false,
	);
	expect(hasPlaybackData({ readyState: 1, currentTime: 2, buffered })).toBe(
		false,
	);
	expect(
		hasPlaybackData({
			readyState: 2,
			currentTime: 2,
			buffered: { length: 0, start: () => 0, end: () => 0 },
		}),
	).toBe(false);
});
