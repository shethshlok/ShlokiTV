import type { RoomMedia, RoomMember, RoomSnapshot } from "./types.js";

/** A paused Safari player can have a decoded frame and buffered future data without advancing readyState to 3. */
export function hasPlaybackData(
	video: Pick<HTMLVideoElement, "readyState" | "currentTime" | "buffered">,
): boolean {
	if (video.readyState >= 3) {
		return true;
	}
	if (video.readyState < 2) {
		return false;
	}
	for (let index = 0; index < video.buffered.length; index++) {
		if (
			video.buffered.start(index) <= video.currentTime &&
			video.buffered.end(index) - video.currentTime > 0.5
		) {
			return true;
		}
	}
	return false;
}

/** Someone pressed play, but the room is holding the clock for a viewer to catch up. */
export function holdingForViewers(room: RoomSnapshot | null): boolean {
	return !!room?.requestedPlaying && !room.playing;
}

/** `Guest`, `your player`, or `Host and your player`: who the room is waiting on. */
export function waitingNames(room: RoomSnapshot | null, self?: string) {
	const waiting = (room?.members ?? []).filter(
		(m) => !(m.ready && m.connected),
	);
	return {
		count: waiting.length,
		names: waiting
			.map((m) => (m.id === self ? "your player" : m.name))
			.join(" and "),
	};
}

/** A viewer's dot in the panel: `here` means connected while nothing is picked yet. */
export function memberStatus(
	member: Pick<RoomMember, "ready" | "connected">,
	room: Pick<RoomSnapshot, "media">,
): "ready" | "here" | "loading" | "away" {
	if (!member.connected) {
		return "away";
	}
	if (!room.media) {
		return "here";
	}
	return member.ready ? "ready" : "loading";
}

/** The player route for the room's title, or null while the room is a lobby. */
export function roomPath(room: Pick<RoomSnapshot, "media"> | null) {
	return room?.media
		? `/player/${room.media.type}/${encodeURIComponent(room.media.id)}`
		: null;
}

/**
 * The `media` command a player should send so the room matches what it plays, or
 * null. A lobby pick carries the player's place, such as a resumed episode.
 */
export function titleUpdate(
	room: Pick<RoomSnapshot, "media">,
	media: RoomMedia | null,
	video: Pick<HTMLVideoElement, "duration" | "currentTime"> | null,
) {
	if (!(media && video && Number.isFinite(video.duration))) {
		return null;
	}
	if (video.duration <= 0) {
		return null;
	}
	const current = room.media;
	const same =
		!!current &&
		current.id === media.id &&
		current.type === media.type &&
		current.label === media.label &&
		current.title === media.title &&
		Math.abs(current.duration - video.duration) <= 0.5;
	if (same) {
		return null;
	}
	return {
		media: { ...media, duration: video.duration },
		...(current ? {} : { position: video.currentTime }),
	};
}
