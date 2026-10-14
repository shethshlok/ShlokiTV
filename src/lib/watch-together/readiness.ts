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
