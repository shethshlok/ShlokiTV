import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceLoading } from "./source-loading.svelte.ts";
import { pickPreferredStream, type ResolvedStream } from "./stream-format.ts";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); vi.useRealTimers(); });

describe("background source discovery", () => {
	it("keeps collecting later sources after a manual choice without replacing it", async () => {
		vi.useFakeTimers();
		const low: ResolvedStream = {
			index: 0, url: "https://example.com/720.mp4", externalUrl: null,
			notWebReady: false, name: "720p AAC", title: null, description: null,
			addonName: "First", fileSize: null, infoHash: null, filename: null,
		};
		const high = { ...low, index: 1, url: "https://example.com/4k.mp4", name: "4K AAC" };
		let current = $state({ pending: true, streams: [low], errors: [] });
		const refresh = vi.fn(async () => { current = { pending: false, streams: [low, high], errors: [] }; });
		const query = { get current() { return current; }, refresh };
		let selected = $state<ResolvedStream | null>(null);
		const choice = () => selected;
		let search!: ReturnType<typeof sourceLoading>;
		cleanup = $effect.root(() => {
			search = sourceLoading(() => query, () => "episode-14");
			$effect(() => {
				if (!selected) selected = pickPreferredStream(query.current.streams, "auto", search.searching);
			});
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(choice()).toBeNull();
		selected = low;
		await vi.advanceTimersByTimeAsync(2000);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(query.current.streams).toHaveLength(2);
		expect(choice()?.url).toBe(low.url);
		expect(search.searching).toBe(false);
	});

	it("retries an empty addon failure and resumes polling the background search", async () => {
		vi.useFakeTimers();
		let current = $state({ pending: false, streams: [] as unknown[], errors: [{ message: "Addon timed out" }] });
		const refresh = vi.fn(async () => {
			current = refresh.mock.calls.length === 1
				? { pending: true, streams: [], errors: [] }
				: { pending: false, streams: [{ url: "https://example.com/video.mp4" }], errors: [] };
		});
		const query = { get current() { return current; }, refresh };
		let search!: ReturnType<typeof sourceLoading>;
		cleanup = $effect.root(() => { search = sourceLoading(() => query, () => "episode-14"); });
		await vi.advanceTimersByTimeAsync(0);
		expect(search.searching).toBe(true);
		await vi.advanceTimersByTimeAsync(2000);
		expect(search.searching).toBe(true);
		await vi.advanceTimersByTimeAsync(2000);
		expect(refresh).toHaveBeenCalledTimes(2);
		expect(search.searching).toBe(false);
		expect(search.failed).toBe(false);
		expect(query.current.streams).toHaveLength(1);
	});

	it("waits for the final retry, then exposes persistent addon failures and allows retry", async () => {
		vi.useFakeTimers();
		let finish!: () => void;
		const refresh = vi.fn(async () => {
			if (refresh.mock.calls.length === 3) await new Promise<void>((resolve) => { finish = resolve; });
		});
		const query = { current: { pending: false, streams: [], errors: [{ message: "stream request failed with 502" }] }, refresh };
		let search!: ReturnType<typeof sourceLoading>;
		cleanup = $effect.root(() => { search = sourceLoading(() => query, () => "episode-14"); });
		await vi.advanceTimersByTimeAsync(6000);
		expect(refresh).toHaveBeenCalledTimes(3);
		expect(search.searching).toBe(true);
		finish();
		await vi.advanceTimersByTimeAsync(0);
		expect(search.searching).toBe(false);
		expect(search.failed).toBe(true);
		await vi.advanceTimersByTimeAsync(4000);
		expect(refresh).toHaveBeenCalledTimes(3);
		search.restart();
		await vi.advanceTimersByTimeAsync(2000);
		expect(refresh).toHaveBeenCalledTimes(4);
	});

	it.each([
		{ streams: [], errors: [] },
		{ streams: [{ url: "https://example.com/video.mp4" }], errors: [{ message: "Other addon timed out" }] },
	])("does not retry completed results or hide available streams: %j", async (result) => {
		vi.useFakeTimers();
		const query = { current: { pending: false, ...result }, refresh: vi.fn(async () => {}) };
		let search!: ReturnType<typeof sourceLoading>;
		cleanup = $effect.root(() => { search = sourceLoading(() => query, () => "episode-14"); });
		await vi.advanceTimersByTimeAsync(6000);
		expect(search.searching).toBe(false);
		expect(search.failed).toBe(false);
		expect(query.refresh).not.toHaveBeenCalled();
	});

	it("keeps loading an empty pending snapshot, then stops on completion", async () => {
		vi.useFakeTimers();
		let current = $state({ pending: true });
		const refresh = vi.fn(async () => { current = { pending: false }; });
		const query = { get current() { return current; }, refresh };
		let search!: ReturnType<typeof sourceLoading>;
		cleanup = $effect.root(() => { search = sourceLoading(() => query, () => "episode-9"); });
		await vi.advanceTimersByTimeAsync(0);
		expect(search.searching).toBe(true);
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(0);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(search.searching).toBe(false);
		await vi.advanceTimersByTimeAsync(4000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("stops a stuck provider after the budget and allows a fresh retry", async () => {
		vi.useFakeTimers();
		const query = { current: { pending: true }, refresh: vi.fn(async () => {}) };
		let search!: ReturnType<typeof sourceLoading>;
		cleanup = $effect.root(() => { search = sourceLoading(() => query, () => "episode-9"); });
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(120_000);
		await vi.advanceTimersByTimeAsync(0);
		expect(search.expired).toBe(true);
		expect(search.searching).toBe(false);
		search.restart();
		await vi.advanceTimersByTimeAsync(0);
		expect(search.searching).toBe(true);
	});

	it("cancels polling when the source drawer is closed", async () => {
		vi.useFakeTimers();
		const query = { current: { pending: true }, refresh: vi.fn(async () => {}) };
		cleanup = $effect.root(() => { sourceLoading(() => query, () => "episode-9"); });
		await vi.advanceTimersByTimeAsync(0);
		cleanup?.();
		cleanup = undefined;
		await vi.advanceTimersByTimeAsync(4000);
		expect(query.refresh).not.toHaveBeenCalled();
	});
});
