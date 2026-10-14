import * as v from "valibot";
import { type Membership, type RoomSnapshot, roomPosition } from "./types.js";

const finite = (min: number, max: number) =>
	v.pipe(v.number(), v.finite(), v.minValue(min), v.maxValue(max));
export const diagnosticsSchema = v.object({
	event: v.picklist([
		"sample",
		"play-tap",
		"play-started",
		"play-blocked",
		"buffering",
		"drift-correction",
	]),
	position: finite(0, 86_400),
	driftMs: finite(-86_400_000, 86_400_000),
	bufferAhead: finite(0, 86_400),
	readyState: finite(0, 4),
	paused: v.boolean(),
	seeking: v.boolean(),
	blocked: v.boolean(),
	mismatch: v.boolean(),
	rate: finite(0, 4),
	rttMs: finite(0, 60_000),
	clockOffsetMs: finite(-86_400_000, 86_400_000),
	stateAgeMs: finite(0, 86_400_000),
});
export type PlaybackSample = v.InferOutput<typeof diagnosticsSchema>;

export function playbackSample(
	input: {
		video: Pick<
			HTMLVideoElement,
			| "buffered"
			| "currentTime"
			| "readyState"
			| "paused"
			| "seeking"
			| "playbackRate"
		>;
		room: RoomSnapshot;
		event: PlaybackSample["event"];
		offset: number;
		rttMs: number;
		stateReceivedAt: number;
		blocked: boolean;
		mismatch: boolean;
	},
	now = Date.now(),
): PlaybackSample {
	const { video } = input;
	let bufferAhead = 0;
	for (let i = 0; i < video.buffered.length; i++) {
		if (
			video.buffered.start(i) <= video.currentTime &&
			video.buffered.end(i) >= video.currentTime
		) {
			bufferAhead = video.buffered.end(i) - video.currentTime;
		}
	}
	return {
		event: input.event,
		position: video.currentTime,
		driftMs: Math.round(
			(video.currentTime - roomPosition(input.room, now + input.offset)) * 1000,
		),
		bufferAhead,
		readyState: video.readyState,
		paused: video.paused,
		seeking: video.seeking,
		blocked: input.blocked,
		mismatch: input.mismatch,
		rate: video.playbackRate,
		rttMs: input.rttMs,
		clockOffsetMs: Math.round(input.offset),
		stateAgeMs: Math.max(0, now - input.stateReceivedAt),
	};
}

export class PlaybackReporter {
	at = 0;
	rttMs = 0;
	stateReceivedAt = 0;
	constructor(
		private readonly request: (
			body: Record<string, unknown>,
		) => Promise<unknown>,
	) {}
	report(input: {
		membership: Membership | null;
		room: RoomSnapshot | null;
		video: HTMLVideoElement | null;
		connected: boolean;
		event: PlaybackSample["event"];
		offset: number;
		blocked: boolean;
		mismatch: boolean;
	}) {
		const { membership, room, video } = input;
		if (!(membership && room && video && input.connected)) {
			return;
		}
		this.at = Date.now();
		const sample = playbackSample({
			...input,
			room,
			video,
			rttMs: this.rttMs,
			stateReceivedAt: this.stateReceivedAt,
		});
		// This request is separate from the playback command queue and cannot block it.
		void this.request({ ...membership, action: "diagnostics", sample }).catch(
			() => {
				// Best effort only. A telemetry failure must not become a playback error.
			},
		);
	}
}
