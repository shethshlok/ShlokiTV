import { expect, it } from "vitest";
import {
	hasPlaybackData,
	holdingForViewers,
	waitingNames,
} from "./readiness.js";
import type { RoomSnapshot } from "./types.js";

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

it("names who a requested play is waiting on", () => {
	const room = {
		requestedPlaying: true,
		playing: false,
		members: [
			{ id: "a", name: "Host", ready: true, connected: true, call: false },
			{ id: "b", name: "Guest", ready: false, connected: true, call: false },
		],
	} as RoomSnapshot;
	expect(holdingForViewers(room)).toBe(true);
	expect(waitingNames(room, "a")).toEqual({ count: 1, names: "Guest" });
	expect(waitingNames(room, "b")).toEqual({ count: 1, names: "your player" });
	room.members[0].connected = false;
	expect(waitingNames(room, "b").names).toBe("Host and your player");
	expect(holdingForViewers({ ...room, playing: true })).toBe(false);
	expect(holdingForViewers(null)).toBe(false);
	expect(waitingNames(null)).toEqual({ count: 0, names: "" });
});
