import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as v from "valibot";
import { expect, it } from "vitest";
import {
	diagnosticsSchema,
	type PlaybackSample,
	playbackSample,
} from "./diagnostics.js";
import { diagnosticRecord, PlaybackDiagnostics } from "./diagnostics.server.js";
import type { RoomSnapshot } from "./types.js";

const sample: PlaybackSample = {
	event: "sample",
	position: 12,
	driftMs: -45,
	bufferAhead: 30,
	readyState: 4,
	paused: false,
	seeking: false,
	blocked: false,
	mismatch: false,
	rate: 1,
	rttMs: 80,
	clockOffsetMs: 5,
	stateAgeMs: 1200,
};
const room: RoomSnapshot = {
	code: "private-invite-code",
	host: "private-member-id",
	revision: 1,
	sequence: 3,
	media: {
		type: "movie",
		id: "title",
		title: "Private title",
		label: "https://secret/stream",
		duration: 100,
	},
	position: 12,
	playing: true,
	requestedPlaying: true,
	rate: 1,
	audio: null,
	serverTime: 1000,
	members: [
		{
			id: "private-member-id",
			name: "Private name",
			ready: true,
			connected: true,
			call: false,
		},
	],
};
it("records timing measurements without raw room, membership, media, or extra fields", () => {
	const record = diagnosticRecord(room, room.host, {
		...sample,
		token: "secret-token",
		url: "https://secret/url",
	} as PlaybackSample);
	const text = JSON.stringify(record);
	for (const forbidden of [
		room.code,
		room.host,
		String(room.media?.title),
		String(room.media?.label),
		"Private name",
		"secret-token",
		"https://secret/url",
	]) {
		expect(text).not.toContain(forbidden);
	}
	expect(record.driftMs).toBe(-45);
	expect(record.role).toBe("host");
	expect(record.readyViewers).toBe(1);
	expect(diagnosticRecord(room, room.host, sample).viewer).toBe(record.viewer);
});
it("rejects invalid or unbounded measurements", () => {
	for (const value of [
		{ ...sample, driftMs: Number.NaN },
		{ ...sample, rttMs: -1 },
		{ ...sample, event: "secret text" },
	]) {
		expect(v.safeParse(diagnosticsSchema, value).success).toBe(false);
	}
});
it("rotates bounded logs, preserves private file permissions, and tolerates write failures", async () => {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "shlokitv-diagnostics-"),
	);
	try {
		const logger = new PlaybackDiagnostics(700);
		const record = diagnosticRecord(room, room.host, sample);
		for (let i = 0; i < 5; i++) {
			await logger.write(directory, { ...record, at: i });
		}
		const folder = path.join(directory, "watch-together");
		expect((await readdir(folder)).sort()).toEqual([
			"playback.jsonl",
			"playback.jsonl.1",
		]);
		expect(
			JSON.parse(
				(await readFile(path.join(folder, "playback.jsonl"), "utf8")).trim(),
			).at,
		).toBe(4);
		expect((await stat(path.join(folder, "playback.jsonl"))).mode & 0o777).toBe(
			0o600,
		);
		await expect(
			logger.write(path.join(folder, "playback.jsonl"), record),
		).resolves.toBeUndefined();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("measures drift against the corrected room clock and buffered media ahead", () => {
	const measured = playbackSample(
		{
			video: {
				currentTime: 14.1,
				readyState: 4,
				paused: false,
				seeking: false,
				playbackRate: 1,
				buffered: { length: 1, start: () => 10, end: () => 20 },
			},
			room,
			event: "sample",
			offset: 100,
			rttMs: 80,
			stateReceivedAt: 2700,
			blocked: false,
			mismatch: false,
		},
		3000,
	);
	expect(measured.driftMs).toBe(0);
	expect(measured.bufferAhead).toBeCloseTo(5.9);
	expect(measured.stateAgeMs).toBe(300);
});
