import type { ResolvedStream } from "#lib/watch/stream-format.js";
import type { RoomMedia } from "./types.js";
/** URLs are account-specific, so only compare file metadata. Never infer a match from resolution alone. */
export function matchingSource(
	media: RoomMedia,
	streams: ResolvedStream[],
): ResolvedStream | null {
	return (
		streams.find(
			(stream) =>
				!!stream.url &&
				!stream.notWebReady &&
				((!!media.filename &&
					stream.filename === media.filename &&
					!!media.fileSize &&
					stream.fileSize === media.fileSize) ||
					(!!media.infoHash &&
						stream.infoHash?.toLowerCase() === media.infoHash.toLowerCase() &&
						!!media.filename &&
						stream.filename === media.filename)),
		) ?? null
	);
}
