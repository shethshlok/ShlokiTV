export interface RoomMedia {
	type: string;
	id: string;
	title: string;
	label: string;
	filename?: string | null;
	infoHash?: string | null;
	fileSize?: number | null;
	duration: number;
}
export interface RoomMember {
	id: string;
	name: string;
	ready: boolean;
	connected: boolean;
	call: boolean;
}
export interface RoomSnapshot {
	code: string;
	host: string;
	media: RoomMedia;
	revision: number;
	sequence: number;
	position: number;
	playing: boolean;
	requestedPlaying: boolean;
	rate: number;
	serverTime: number;
	members: RoomMember[];
}
export interface Membership {
	code: string;
	member: string;
	token: string;
}
export interface CallSignal {
	description?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
}
export function roomPosition(room: RoomSnapshot, now: number): number {
	return Math.min(
		room.media.duration || Number.POSITIVE_INFINITY,
		Math.max(
			0,
			room.position +
				(room.playing
					? (Math.max(0, now - room.serverTime) / 1000) * room.rate
					: 0),
		),
	);
}
export function syncAdjustment(gap: number, rate: number) {
	if (Math.abs(gap) > 2) {
		return { seek: true, rate };
	}
	return {
		seek: false,
		rate:
			Math.abs(gap) > 0.15
				? rate * (1 + Math.max(-0.05, Math.min(0.05, gap / 20)))
				: rate,
	};
}
