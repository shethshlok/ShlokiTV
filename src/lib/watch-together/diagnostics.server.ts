import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import * as v from "valibot";
import { diagnosticsSchema, type PlaybackSample } from "./diagnostics.js";
import type { RoomSnapshot } from "./types.js";

const MAX_BYTES = 3 * 1024 * 1024;
const pseudonym = (value: string) =>
	createHash("sha256").update(value).digest("hex").slice(0, 16);

/** Allowlisted measurements only. Never serialize a membership, room media, or account. */
export function diagnosticRecord(
	room: RoomSnapshot,
	member: string,
	sample: PlaybackSample,
	now = Date.now(),
) {
	return {
		at: now,
		room: pseudonym(room.code),
		viewer: pseudonym(`${room.code}:${member}`),
		role: member === room.host ? "host" : "guest",
		revision: room.revision,
		sequence: room.sequence,
		serverPlaying: room.playing,
		requestedPlaying: room.requestedPlaying,
		readyViewers: room.members.filter((m) => m.ready).length,
		connectedViewers: room.members.filter((m) => m.connected).length,
		...v.parse(diagnosticsSchema, sample),
	};
}

/** Bounded background writes cannot delay a playback command or grow an unlimited queue. */
export class PlaybackDiagnostics {
	private queue = Promise.resolve();
	private pending = 0;
	constructor(private readonly maxBytes = MAX_BYTES) {}
	write(
		directory: string,
		record: ReturnType<typeof diagnosticRecord>,
	): Promise<void> {
		if (this.pending >= 128) {
			return Promise.resolve();
		}
		this.pending++;
		const work = this.queue
			.then(() => this.append(directory, record))
			.catch(() => {
				// A full disk or unwritable log directory must not interrupt the room.
			})
			.finally(() => {
				this.pending--;
			});
		this.queue = work;
		return work;
	}
	private async append(
		directory: string,
		record: ReturnType<typeof diagnosticRecord>,
	) {
		const folder = path.join(directory, "watch-together");
		const file = path.join(folder, "playback.jsonl");
		await mkdir(folder, { recursive: true });
		const size = await stat(file).then(
			(s) => s.size,
			() => 0,
		);
		const line = `${JSON.stringify(record)}\n`;
		if (size + Buffer.byteLength(line) > this.maxBytes) {
			await rename(file, `${file}.1`).catch((error) => {
				if (error.code !== "ENOENT") {
					throw error;
				}
			});
		}
		await appendFile(file, line, { mode: 0o600 });
	}
}
export const playbackDiagnostics = new PlaybackDiagnostics();
