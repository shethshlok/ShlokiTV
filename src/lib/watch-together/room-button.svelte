<script lang="ts">
	import UsersIcon from "@lucide/svelte/icons/users";
	import { cn } from "#lib/utils.js";
	import { together } from "./client.svelte.js";

	// Rooms work before anything plays: connect first, pick a title together.
	const label = $derived(
		together.membership
			? `Watch room · ${together.room?.members.length ?? 1}/2`
			: "Watch together",
	);
</script>

<button
    type="button"
    aria-expanded={together.panelOpen}
    aria-controls="watch-room-controls"
    aria-label={label}
    onclick={() => (together.panelOpen = !together.panelOpen)}
    class={cn(
        "relative flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm shadow-[inset_0_1px_0_var(--glass-edge)] backdrop-blur-md transition-colors hover:bg-foreground/10",
        together.membership || together.panelOpen
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
    )}
>
    <UsersIcon class="size-4" />
    <span class="hidden sm:inline" aria-hidden="true">
        {together.membership
            ? `Room · ${together.room?.members.length ?? 1}/2`
            : "Watch together"}
    </span>
    {#if together.membership}
        <span
            aria-hidden="true"
            class={cn(
                "absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
                together.connected
                    ? "bg-emerald-400"
                    : "animate-pulse bg-amber-400",
            )}
        ></span>
    {/if}
</button>
