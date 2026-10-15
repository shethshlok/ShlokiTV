import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { error } from "@sveltejs/kit";
import { sharedAudioChoice } from "#lib/player/audio-language.js";
import {
	type RoomAudio,
	type RoomMedia,
	type RoomMember,
	type RoomPreview,
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
	media: RoomMedia | null;
	revision: number;
	sequence: number;
	position: number;
	requestedPlaying: boolean;
	playing: boolean;
	rate: number;
	audio: RoomAudio | null;
	updated: number;
	created: number;
	touched: number;
	members: Map<string, Member>;
}
const key = () => randomBytes(18).toString("base64url");
export class WatchRooms {
	private readonly rooms = new Map<string, Room>();
	private file: string | null = null;
	private saving: ReturnType<typeof setTimeout> | undefined;
	constructor(private readonly now = () => Date.now()) {}
	/** Keep rooms on disk so a restart or deploy does not end them. Loads once. */
	useStore(directory: string) {
		if (this.file) {
			return;
		}
		this.file = path.join(directory, "watch-together", "rooms.json");
		try {
			this.load(JSON.parse(readFileSync(this.file, "utf8")));
		} catch {
			// No saved rooms yet, or an unreadable file: start empty.
		}
	}
	private load(saved: unknown) {
		if (!Array.isArray(saved)) {
			return;
		}
		const now = this.now();
		for (const room of saved as Array<(Room & { members: Member[] }) | null>) {
			if (typeof room?.code !== "string" || !Array.isArray(room.members)) {
				continue;
			}
			// Viewers get the usual reconnect grace from the moment the server is back.
			const members = room.members.map((m) => ({
				...m,
				connected: false,
				ready: false,
				call: false,
				seen: now,
				listeners: new Set<(event: string, value: unknown) => void>(),
				bucket: 0,
				requests: 0,
			}));
			this.rooms.set(room.code, {
				...room,
				audio: sharedAudioChoice(room.audio),
				playing: false,
				updated: now,
				members: new Map(members.map((m) => [m.id, m])),
			});
		}
	}
	/** Rooms as of now, with the shared clock stopped where it stands. */
	serialize() {
		return [...this.rooms.values()].map((room) => ({
			...room,
			position: roomPosition(this.snapshot(room), this.now()),
			playing: false,
			members: [...room.members.values()].map(
				({ listeners: _listeners, ...member }) => member,
			),
		}));
	}
	private save() {
		const file = this.file;
		if (!file || this.saving) {
			return;
		}
		this.saving = setTimeout(() => {
			this.saving = undefined;
			const temporary = `${file}.tmp`;
			void mkdir(path.dirname(file), { recursive: true })
				.then(() =>
					writeFile(temporary, JSON.stringify(this.serialize()), {
						mode: 0o600,
					}),
				)
				.then(() => rename(temporary, file))
				.catch(() => {
					// Rooms keep working in memory when the data directory is unwritable.
				});
		}, 250);
		this.saving.unref?.();
	}
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
			audio: room.audio,
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
			!!room.media &&
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
		this.save();
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
				this.save();
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
	/** What an invite leads to, shown before joining. */
	preview(code: string): RoomPreview {
		this.sweep();
		const room = this.find(code);
		return {
			host: room.members.get(room.host)?.name ?? "Someone",
			title: room.media?.title || null,
			members: room.members.size,
			full: room.members.size >= 2,
		};
	}
	create(
		user: string,
		name: string,
		media: RoomMedia | null,
		start: { position?: number; playing?: boolean } = {},
	) {
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
			position: media
				? Math.min(
						media.duration || Number.POSITIVE_INFINITY,
						Math.max(0, start.position ?? 0),
					)
				: 0,
			requestedPlaying: !!media && start.playing === true,
			// A host who is already playing has data; keep the clock running until they connect.
			playing: !!media && start.playing === true,
			rate: 1,
			audio: null,
			updated: now,
			created: now,
			touched: now,
			members: new Map(),
		};
		const membership = this.add(room, user, name);
		room.host = membership.member;
		const host = room.members.get(membership.member);
		if (host) {
			host.ready = !!media && start.playing === true;
		}
		this.rooms.set(room.code, room);
		this.save();
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
	/** In a lobby, whoever picks the first title hosts it. */
	/** Heartbeats arrive every 10 s per viewer; broadcast only what changed. */
	private heartbeat(room: Room, member: Member, ready: boolean) {
		const connected = member.listeners.size > 0;
		if (
			connected === member.connected &&
			(connected && ready) === member.ready
		) {
			room.touched = this.now();
			return;
		}
		member.connected = connected;
		member.ready = connected && ready;
		this.update(room);
	}
	private setMedia(room: Room, id: string, body: Record<string, unknown>) {
		const next = (body.media ?? null) as RoomMedia | null;
		const newTitle =
			!next || next.id !== room.media?.id || next.type !== room.media.type;
		// Anyone may pick a title; only its picker refines it (source, duration).
		if (room.media && room.host !== id && !newTitle) {
			error(403, "Only the viewer who picked this title can update it.");
		}
		room.host = id;
		if (newTitle) {
			// A pick keeps the picker's place, such as a resumed episode.
			room.position =
				next && typeof body.position === "number" ? body.position : 0;
			room.requestedPlaying = !!next;
		}
		room.media = next;
		room.revision++;
		for (const m of room.members.values()) {
			m.ready = false;
		}
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
		if (body.action === "diagnostics") {
			return;
		}
		if (body.action === "heartbeat") {
			this.heartbeat(room, member, body.ready === true);
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
				this.save();
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
			case "audio": {
				const choice = sharedAudioChoice(
					body.audio as { language?: string | null; label?: string | null },
				);
				if (!choice) {
					error(400, "Missing audio choice.");
				}
				room.audio = choice;
				break;
			}
			case "media":
				this.setMedia(room, id, body);
				break;
			default:
				error(400, "Unknown room action.");
		}
		room.position = Math.min(
			room.media?.duration || Number.POSITIVE_INFINITY,
			Math.max(0, room.position),
		);
		this.update(room);
	}
}
export const watchRooms = new WatchRooms();
const timer = setInterval(() => watchRooms.sweep(), 10_000);
timer.unref?.();
