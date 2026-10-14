import type { RoomSnapshot } from "./types.js";

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
