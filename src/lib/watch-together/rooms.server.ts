import { randomBytes } from "node:crypto";
import { error } from "@sveltejs/kit";
import {
	type RoomMedia,
	type RoomMember,
	type RoomSnapshot,
	roomPosition,
} from "./types.js";

interface Member extends RoomMember {
	user: string;
	token: string;
	seen: number;
	listeners: Set<(event: string, value: unknown) => void>;
	bucket: number;
	requests: number;
}
interface Room {
	code: string;
	host: string;
	media: RoomMedia;
	revision: number;
	sequence: number;
	position: number;
	requestedPlaying: boolean;
	playing: boolean;
	rate: number;
	updated: number;
	created: number;
	touched: number;
	members: Map<string, Member>;
}
const key = () => randomBytes(18).toString("base64url");
export class WatchRooms {
	private readonly rooms = new Map<string, Room>();
	constructor(private readonly now = () => Date.now()) {}
	snapshot(room: Room): RoomSnapshot {
		return {
			code: room.code,
			host: room.host,
			media: room.media,
			revision: room.revision,
			sequence: room.sequence,
			position: room.position,
			playing: room.playing,
			requestedPlaying: room.requestedPlaying,
			rate: room.rate,
			serverTime: room.updated,
			members: [...room.members.values()].map(
				({ id, name, ready, connected, call }) => ({
					id,
					name,
					ready,
					connected,
					call,
				}),
			),
		};
	}
	private update(room: Room) {
		room.position = roomPosition(this.snapshot(room), this.now());
		room.updated = this.now();
		room.playing =
			room.requestedPlaying &&
			[...room.members.values()].every((m) => m.ready && m.connected);
		room.sequence++;
		room.touched = this.now();
		const state = this.snapshot(room);
		for (const member of room.members.values()) {
			for (const send of member.listeners) {
				send("state", state);
			}
		}
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Sweep handles membership expiry, host transfer and room expiry in one bounded pass.
	sweep() {
		const now = this.now();
		for (const [code, room] of this.rooms) {
			for (const [id, m] of room.members) {
				if (m.connected && now - m.seen > 35_000) {
					m.connected = false;
					m.ready = false;
				}
				if (!m.connected && now - m.seen > 45_000) {
					for (const send of m.listeners) {
						send("closed", {});
					}
					room.members.delete(id);
				}
			}
			if (!room.members.has(room.host)) {
				room.host = room.members.keys().next().value ?? "";
			}
			if (
				!room.members.size ||
				now - room.touched > 2 * 3_600_000 ||
				now - room.created > 12 * 3_600_000
			) {
				for (const m of room.members.values()) {
					for (const send of m.listeners) {
						send("closed", {});
					}
				}
				this.rooms.delete(code);
			} else {
				this.update(room);
			}
		}
	}
	private find(code: string) {
		const room = this.rooms.get(code);
		if (!room) {
			error(404, "This watch room has ended. Create a new room.");
		}
		return room;
	}
	private add(room: Room, user: string, name: string) {
		if (room.members.size >= 2) {
			error(409, "This room already has two viewers.");
		}
		const id = key(),
			token = key();
		room.members.set(id, {
			id,
			token,
			user,
			name,
			ready: false,
			connected: false,
			call: false,
			seen: this.now(),
			listeners: new Set(),
			bucket: 0,
			requests: 0,
		});
		return { code: room.code, member: id, token };
	}
	create(user: string, name: string, media: RoomMedia) {
		this.sweep();
		if (
			this.rooms.size >= 100 ||
			[...this.rooms.values()].filter((r) =>
				[...r.members.values()].some((m) => m.user === user),
			).length >= 3
		) {
			error(429, "Leave an existing room before creating another.");
		}
		const now = this.now();
		const room: Room = {
			code: key(),
			host: "",
			media,
			revision: 1,
			sequence: 1,
			position: 0,
			requestedPlaying: false,
			playing: false,
			rate: 1,
			updated: now,
			created: now,
			touched: now,
			members: new Map(),
		};
		const membership = this.add(room, user, name);
		room.host = membership.member;
		this.rooms.set(room.code, room);
		return membership;
	}
	join(code: string, user: string, name: string) {
		this.sweep();
		const room = this.find(code);
		const result = this.add(room, user, name);
		this.update(room);
		return result;
	}
	authorize(code: string, id: string, token: string, user: string) {
		const room = this.find(code),
			member = room.members.get(id);
		if (!member || member.token !== token || member.user !== user) {
			error(403, "You are not a member of this watch room.");
		}
		return { room, member };
	}
	// biome-ignore lint/complexity/useMaxParams: These are the four authorization fields plus the stream callback.
	connect(
		code: string,
		id: string,
		token: string,
		user: string,
		send: (event: string, value: unknown) => void,
	) {
		const { room, member } = this.authorize(code, id, token, user);
		// Reconnecting replaces an old stream, rather than allowing two tabs to impersonate one viewer.
		for (const listener of member.listeners) {
			listener("replaced", {});
		}
		member.listeners.clear();
		member.listeners.add(send);
		member.connected = true;
		member.seen = this.now();
		this.update(room);
		return () => {
			member.listeners.delete(send);
			if (!member.listeners.size) {
				member.connected = false;
				member.ready = false;
				member.call = false;
				member.seen = this.now();
				this.update(room);
			}
		};
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: All mutations share authorization, time advancement and one final broadcast.
	// biome-ignore lint/complexity/useMaxParams: These are the four authorization fields plus the validated command.
	command(
		code: string,
		id: string,
		token: string,
		user: string,
		body: Record<string, unknown>,
	) {
		const { room, member } = this.authorize(code, id, token, user);
		const bucket = Math.floor(this.now() / 1000);
		if (member.bucket !== bucket) {
			member.bucket = bucket;
			member.requests = 0;
		}
		if (++member.requests > 30) {
			error(429, "Too many room updates.");
		}
		member.seen = this.now();
		if (body.action === "heartbeat") {
			member.connected = member.listeners.size > 0;
			member.ready = member.connected && body.ready === true;
			this.update(room);
			return;
		}
		if (body.action === "leave") {
			for (const send of member.listeners) {
				send("closed", {});
			}
			room.members.delete(id);
			if (room.host === id) {
				room.host = room.members.keys().next().value ?? "";
			}
			if (!room.members.size) {
				this.rooms.delete(code);
			} else {
				this.update(room);
			}
			return;
		}
		if (body.action === "signal") {
			const target = room.members.get(String(body.target));
			if (!(target && member.call && target.call)) {
				error(409, "Both viewers must join the call first.");
			}
			for (const send of target.listeners) {
				send("signal", { from: id, signal: body.signal });
			}
			return;
		}
		if (body.action === "call") {
			member.call = body.enabled === true;
			this.update(room);
			return;
		}
		if (body.revision !== room.revision) {
			error(409, "The room changed titles. Wait for the new player to load.");
		}
		room.position = roomPosition(this.snapshot(room), this.now());
		room.updated = this.now();
		switch (body.action) {
			case "ready":
				member.ready = body.ready === true;
				break;
			case "play":
				room.requestedPlaying = true;
				if (typeof body.position === "number") {
					room.position = body.position;
				}
				break;
			case "pause":
				room.requestedPlaying = false;
				if (typeof body.position === "number") {
					room.position = body.position;
				}
				break;
			case "seek":
				room.position = body.position as number;
				break;
			case "rate":
				room.rate = body.rate as number;
				break;
			case "media": {
				if (room.host !== id) {
					error(403, "Only the host can change the title or episode.");
				}
				const next = body.media as RoomMedia;
				if (next.id !== room.media.id || next.type !== room.media.type) {
					room.position = 0;
					room.requestedPlaying = true;
				}
				room.media = next;
				room.revision++;
				for (const m of room.members.values()) {
					m.ready = false;
				}
				break;
			}
			default:
				error(400, "Unknown room action.");
		}
		room.position = Math.min(
			room.media.duration || Number.POSITIVE_INFINITY,
			Math.max(0, room.position),
		);
		this.update(room);
	}
}
export const watchRooms = new WatchRooms();
const timer = setInterval(() => watchRooms.sweep(), 10_000);
timer.unref?.();
