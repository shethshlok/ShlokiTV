import { describe, expect, it, vi } from "vitest";
import { recoverSubtitleFailure } from "./hls-subtitle-recovery.ts";

describe("HLS subtitle failure recovery", () => {
	it("resumes video after a malformed default subtitle playlist", () => {
		const hls = { subtitleTrack: 0, subtitleDisplay: true, startLoad: vi.fn() };
		expect(
			recoverSubtitleFailure(hls, {
				fatal: true,
				context: { type: "subtitleTrack" },
			}),
		).toBe(true);
		expect(hls.subtitleTrack).toBe(-1);
		expect(hls.subtitleDisplay).toBe(false);
		expect(hls.startLoad).toHaveBeenCalledTimes(1);
	});

	it.each(["level", "audioTrack", undefined])(
		"does not conceal fatal video or audio errors: %s",
		(type) => {
			const hls = {
				subtitleTrack: 0,
				subtitleDisplay: true,
				startLoad: vi.fn(),
			};
			expect(
				recoverSubtitleFailure(hls, {
					fatal: true,
					context: type ? { type } : undefined,
				}),
			).toBe(false);
			expect(hls.subtitleTrack).toBe(0);
			expect(hls.startLoad).not.toHaveBeenCalled();
		},
	);

	it("leaves recoverable subtitle errors to HLS", () => {
		const hls = { subtitleTrack: 0, subtitleDisplay: true, startLoad: vi.fn() };
		expect(
			recoverSubtitleFailure(hls, {
				fatal: false,
				context: { type: "subtitleTrack" },
			}),
		).toBe(false);
		expect(hls.startLoad).not.toHaveBeenCalled();
	});
});
