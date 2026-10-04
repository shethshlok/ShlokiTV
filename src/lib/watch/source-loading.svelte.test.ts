import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceLoading } from "./source-loading.svelte.ts";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); vi.useRealTimers(); });

describe("background source discovery", () => {
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
