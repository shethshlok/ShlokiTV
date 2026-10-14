import { describe, expect, it } from "vitest";
import { WatchRooms } from "./rooms.server.js";
import {
	type RoomMedia,
	type RoomSnapshot,
	roomPosition,
	syncAdjustment,
} from "./types.js";

const media: RoomMedia = {
	type: "movie",
	id: "tt1",
	title: "Movie",
	label: "release",
	duration: 100,
};
function setup() {
	let now = 1000;
	const rooms = new WatchRooms(() => now);
	const host = rooms.create("u1", "Host", media);
	const guest = rooms.join(host.code, "u2", "Guest");
	let state: RoomSnapshot;
	const disconnect = rooms.connect(
		host.code,
		host.member,
		host.token,
		"u1",
		(event, value) => {
			if (event === "state") {
				state = value as RoomSnapshot;
			}
		},
	);
	rooms.connect(guest.code, guest.member, guest.token, "u2", () => {});
	const command = (
		member = host,
		user = "u1",
		body: Record<string, unknown> = {},
	) =>
		rooms.command(member.code, member.member, member.token, user, {
			revision: state.revision,
			...body,
		});
	return {
		rooms,
		host,
		guest,
		disconnect,
		command,
		get state() {
			return state;
		},
		advance: (ms: number) => {
			now += ms;
		},
	};
}
describe("watch rooms", () => {
	it("holds playback until both viewers are ready and freezes the clock while buffering", () => {
		const s = setup();
		s.command(s.host, "u1", { action: "ready", ready: true });
		s.command(s.host, "u1", { action: "play", position: 5 });
		expect(s.state.playing).toBe(false);
		s.command(s.guest, "u2", { action: "ready", ready: true });
		expect(s.state.playing).toBe(true);
		s.advance(3000);
		s.command(s.guest, "u2", { action: "ready", ready: false });
		expect(s.state.position).toBe(8);
		expect(s.state.playing).toBe(false);
		s.advance(4000);
		s.command(s.guest, "u2", { action: "ready", ready: true });
		expect(s.state.position).toBe(8);
		expect(s.state.playing).toBe(true);
	});
	it("authorizes memberships by user and secret and caps rooms at two viewers", () => {
		const s = setup();
		expect(() =>
			s.rooms.authorize(s.host.code, s.host.member, s.host.token, "u2"),
		).toThrow();
		expect(() =>
			s.rooms.authorize(s.host.code, s.host.member, "wrong", "u1"),
		).toThrow();
		expect(() => s.rooms.join(s.host.code, "u3", "Third")).toThrow();
	});
	it("accepts guest controls, rejects stale revisions, and restricts title changes to the host", () => {
		const s = setup();
		s.command(s.guest, "u2", { action: "seek", position: 42 });
		expect(s.state.position).toBe(42);
		expect(() =>
			s.command(s.guest, "u2", {
				action: "media",
				media: { ...media, id: "tt2" },
			}),
		).toThrow();
		s.command(s.host, "u1", {
			action: "media",
			media: { ...media, id: "tt2" },
		});
		expect(s.state.position).toBe(0);
		expect(() =>
			s.command(s.guest, "u2", { action: "seek", position: 20, revision: 1 }),
		).toThrow();
	});
	it("preserves the position when replacing a failed source for the same title", () => {
		const s = setup();
		s.command(s.host, "u1", { action: "seek", position: 42 });
		s.command(s.host, "u1", {
			action: "media",
			media: { ...media, label: "replacement" },
		});
		expect(s.state.position).toBe(42);
		expect(s.state.members.every((m) => !m.ready)).toBe(true);
	});
	it("reconnects a member during the grace period and transfers host ownership after departure", () => {
		const s = setup();
		s.disconnect();
		s.advance(30_000);
		s.rooms.sweep();
		expect(s.state.host).toBe(s.host.member);
		s.rooms.connect(s.host.code, s.host.member, s.host.token, "u1", () => {});
		s.command(s.host, "u1", { action: "leave" });
		const auth = s.rooms.authorize(
			s.guest.code,
			s.guest.member,
			s.guest.token,
			"u2",
		);
		expect(s.rooms.snapshot(auth.room).host).toBe(s.guest.member);
	});
	it("only relays call messages between consenting members", () => {
		const s = setup();
		expect(() =>
			s.command(s.host, "u1", {
				action: "signal",
				target: s.guest.member,
				signal: { candidate: { candidate: "test" } },
			}),
		).toThrow();
		s.command(s.host, "u1", { action: "call", enabled: true });
		s.command(s.guest, "u2", { action: "call", enabled: true });
		expect(() =>
			s.command(s.host, "u1", {
				action: "signal",
				target: s.guest.member,
				signal: { candidate: { candidate: "test" } },
			}),
		).not.toThrow();
	});
	it("expires abandoned memberships and removes empty rooms", () => {
		const s = setup();
		s.disconnect();
		s.advance(46_000);
		s.rooms.sweep();
		expect(() =>
			s.rooms.authorize(s.host.code, s.host.member, s.host.token, "u1"),
		).toThrow();
	});
});
describe("timeline correction", () => {
	it("projects time with the shared rate and clamps to the duration", () => {
		expect(
			roomPosition(
				{
					position: 98,
					playing: true,
					rate: 2,
					serverTime: 1000,
					media,
				} as RoomSnapshot,
				4000,
			),
		).toBe(100);
	});
	it("nudges small drift and seeks only large drift", () => {
		expect(syncAdjustment(0.1, 1)).toEqual({ seek: false, rate: 1 });
		expect(syncAdjustment(1, 1)).toEqual({ seek: false, rate: 1.05 });
		expect(syncAdjustment(-3, 1)).toEqual({ seek: true, rate: 1 });
	});
});

it("diagnostic traffic does not change the playback clock or publish room updates", () => {
	const s = setup();
	const before = {
		sequence: s.state.sequence,
		position: s.state.position,
		playing: s.state.playing,
	};
	s.command(s.host, "u1", { action: "diagnostics" });
	expect({
		sequence: s.state.sequence,
		position: s.state.position,
		playing: s.state.playing,
	}).toEqual(before);
});
