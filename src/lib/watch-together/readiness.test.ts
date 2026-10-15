import { expect, it } from "vitest";
import {
	hasPlaybackData,
	holdingForViewers,
	memberStatus,
	roomPath,
	STALL_GRACE_MS,
	steadyReadiness,
	titleUpdate,
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

it("keeps a ready viewer ready through a short dip, but not a real stall", () => {
	const start = 10_000;
	const dip = steadyReadiness({
		hasData: false,
		wasReady: true,
		stalledAt: 0,
		now: start,
	});
	expect(dip).toEqual({ ready: true, stalledAt: start });
	expect(
		steadyReadiness({
			hasData: false,
			wasReady: true,
			stalledAt: dip.stalledAt,
			now: start + STALL_GRACE_MS - 1,
		}).ready,
	).toBe(true);
	expect(
		steadyReadiness({
			hasData: false,
			wasReady: true,
			stalledAt: dip.stalledAt,
			now: start + STALL_GRACE_MS,
		}).ready,
	).toBe(false);
	// Data back clears the stall, so the next dip gets a fresh grace period.
	expect(
		steadyReadiness({
			hasData: true,
			wasReady: true,
			stalledAt: dip.stalledAt,
			now: start + 1000,
		}),
	).toEqual({ ready: true, stalledAt: 0 });
	// A viewer who never had data gets no grace.
	expect(
		steadyReadiness({ hasData: false, wasReady: false, stalledAt: 0, now: 1 }),
	).toEqual({ ready: false, stalledAt: 0 });
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

it("describes viewers and the room's title route, including an empty lobby", () => {
	const media = {
		type: "series",
		id: "tt1:1:2",
		title: "Show",
		label: "",
		duration: 10,
	};
	expect(memberStatus({ connected: true, ready: false }, { media: null })).toBe(
		"here",
	);
	expect(memberStatus({ connected: true, ready: false }, { media })).toBe(
		"loading",
	);
	expect(memberStatus({ connected: true, ready: true }, { media })).toBe(
		"ready",
	);
	expect(memberStatus({ connected: false, ready: true }, { media })).toBe(
		"away",
	);
	expect(roomPath({ media: null })).toBeNull();
	expect(roomPath(null)).toBeNull();
	expect(roomPath({ media })).toBe("/player/series/tt1%3A1%3A2");
});

it("updates the room's title only when the player differs, keeping a lobby picker's place", () => {
	const media = {
		type: "movie",
		id: "tt1",
		title: "Movie",
		label: "a",
		duration: 0,
	};
	const video = { duration: 100, currentTime: 42 };
	expect(titleUpdate({ media: null }, media, video)).toEqual({
		media: { ...media, duration: 100 },
		position: 42,
	});
	expect(
		titleUpdate({ media: { ...media, duration: 100 } }, media, video),
	).toBeNull();
	expect(
		titleUpdate(
			{ media: { ...media, duration: 100 } },
			{ ...media, label: "b" },
			video,
		),
	).toEqual({ media: { ...media, label: "b", duration: 100 } });
	expect(
		titleUpdate(
			{ media: { ...media, duration: 100 } },
			{ ...media, id: "tt2" },
			video,
		),
	).toEqual({ media: { ...media, id: "tt2", duration: 100 }, position: 42 });
	expect(
		titleUpdate({ media: null }, media, {
			duration: Number.NaN,
			currentTime: 0,
		}),
	).toBeNull();
	expect(titleUpdate({ media: null }, null, video)).toBeNull();
});
