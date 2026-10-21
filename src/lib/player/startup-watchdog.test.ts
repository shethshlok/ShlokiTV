import { afterEach, describe, expect, it, vi } from "vitest";
import { startupWatchdog } from "./startup-watchdog.ts";

class Video extends EventTarget {
	readyState = 0;
}
afterEach(() => vi.useRealTimers());

describe("source startup watchdog", () => {
	it("reports a source that never supplies a video frame exactly once", () => {
		vi.useFakeTimers();
		const failed = vi.fn();
		startupWatchdog(new Video(), failed);
		vi.advanceTimersByTime(44_999);
		expect(failed).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(failed).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(90_000);
		expect(failed).toHaveBeenCalledTimes(1);
	});

	it("leaves paused or autoplay-blocked video alone when a frame is available", () => {
		vi.useFakeTimers();
		const video = new Video();
		video.readyState = 4;
		const failed = vi.fn();
		startupWatchdog(video, failed);
		vi.advanceTimersByTime(45_000);
		expect(failed).not.toHaveBeenCalled();
	});

	it("does not mistake later buffering for a failed initial load", () => {
		vi.useFakeTimers();
		const video = new Video();
		const failed = vi.fn();
		startupWatchdog(video, failed);
		video.readyState = 2;
		video.dispatchEvent(new Event("loadeddata"));
		video.readyState = 0;
		vi.advanceTimersByTime(45_000);
		expect(failed).not.toHaveBeenCalled();
	});

	it("cancels the old source's timeout when navigating or selecting another source", () => {
		vi.useFakeTimers();
		const failed = vi.fn();
		const cleanup = startupWatchdog(new Video(), failed);
		cleanup();
		vi.advanceTimersByTime(45_000);
		expect(failed).not.toHaveBeenCalled();
	});
});
