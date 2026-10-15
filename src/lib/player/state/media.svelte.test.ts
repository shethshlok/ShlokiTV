import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayerMedia } from "./media.svelte.ts";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function fakeVideo() {
	const tracks = [
		{ id: "0", label: "English", language: "en", enabled: true },
		{ id: "1", label: "Hindi", language: "hi", enabled: false },
	];
	const audioTracks = Object.assign(tracks, {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
	return {
		audioTracks,
		load: vi.fn(),
		removeAttribute: vi.fn(),
		src: "",
	} as unknown as HTMLVideoElement & { load: ReturnType<typeof vi.fn> };
}

describe("player media attach", () => {
	it("keeps the source attached while state read during attach changes", async () => {
		const video = fakeVideo();
		const onLoad = vi.fn();
		let room = $state(0);
		cleanup = $effect.root(() => {
			createPlayerMedia({
				src: () => "https://example.com/movie.mkv",
				video: () => video,
				onLoad,
				onFatal: vi.fn(),
				// Stands in for the shared room audio, which changes on every room update.
				audioPreference: () => ({ languages: room ? ["hi"] : [], track: null }),
			});
		});
		await tick();
		expect(onLoad).toHaveBeenCalledTimes(1);
		room = 1;
		await tick();
		room = 2;
		await tick();
		expect(onLoad).toHaveBeenCalledTimes(1);
		expect(video.load).toHaveBeenCalledTimes(1);
	});
});
