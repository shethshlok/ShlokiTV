/** Hand a stalled initial load to source recovery without interrupting later pauses or buffering. */
export function startupWatchdog(
	video: Pick<
		HTMLVideoElement,
		"readyState" | "addEventListener" | "removeEventListener"
	>,
	onTimeout: () => void,
	timeoutMs = 45_000,
): () => void {
	const cleanup = () => {
		clearTimeout(timer);
		video.removeEventListener("loadeddata", cleanup);
	};
	const timer = setTimeout(() => {
		cleanup();
		// HAVE_CURRENT_DATA means at least the first video frame has loaded.
		if (video.readyState < 2) {
			onTimeout();
		}
	}, timeoutMs);
	video.addEventListener("loadeddata", cleanup);
	return cleanup;
}
