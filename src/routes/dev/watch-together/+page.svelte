<script lang="ts">
	import RoomButton from "#lib/watch-together/room-button.svelte";
</script>

<!-- A page with no player and the header's room button: rooms connect before anything plays. -->
<main class="flex min-h-dvh items-start justify-end p-4">
    <h1 class="sr-only">Watch together harness</h1>
    <RoomButton />
</main>
