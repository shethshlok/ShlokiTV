import type Hls from "hls.js";

/** A broken optional subtitle playlist must not stop otherwise playable video and audio. */
export function recoverSubtitleFailure(
	hls: Pick<Hls, "subtitleTrack" | "subtitleDisplay" | "startLoad">,
	error: { fatal: boolean; context?: { type: string } | null },
): boolean {
	if (!error.fatal || error.context?.type !== "subtitleTrack") {
		return false;
	}
	hls.subtitleDisplay = false;
	hls.subtitleTrack = -1;
	// HLS stops loading on fatal playlist errors. Resume after disabling the
	// failed subtitle rendition; addon subtitle tracks remain independent.
	hls.startLoad();
	return true;
}
