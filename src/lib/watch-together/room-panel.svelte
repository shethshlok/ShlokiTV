<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { together } from "./client.svelte.js";

	let name = $state("");
	let invite = $state("");
	let busy = $state(false);
	let copied = $state(false);
	let localVideo = $state<HTMLVideoElement | null>(null);
	let remoteVideo = $state<HTMLVideoElement | null>(null);
	let remoteBlocked = $state(false);
	const onPlayer = $derived(page.url.pathname.includes("/player"));
	onMount(() => together.initialize());
	$effect(() => {
		if (page.url.pathname.startsWith("/auth/") && together.membership) {
			untrack(() => void together.leave());
		}
	});
	$effect(() => {
		const code = page.url.searchParams.get("room");
		if (code && code !== together.membership?.code) {
			invite = code;
			together.panelOpen = true;
		}
	});
	$effect(() => {
		const room = together.room;
		if (!room || together.host || page.url.pathname.startsWith("/dev/")) {
			return;
		}
		const path = `/player/${room.media.type}/${encodeURIComponent(room.media.id)}`;
		if (page.url.pathname !== path) {
			void goto(path).catch(() => {
				together.error = "Open the room's title to continue watching.";
			});
		}
	});
	$effect(() => {
		if (localVideo) {
			localVideo.srcObject = together.localStream;
		}
	});
	$effect(() => {
		if (remoteVideo) {
			remoteVideo.srcObject = together.remoteStream;
			if (together.remoteStream) {
				void remoteVideo.play().catch(() => {
					remoteBlocked = true;
				});
			}
		}
	});
	async function act(action: () => Promise<void>) {
		busy = true;
		together.error = "";
		try {
			await action();
			invite = "";
		} catch (error) {
			together.error =
				error instanceof Error ? error.message : "Unable to join the room";
		} finally {
			busy = false;
		}
	}
	async function copyInvite() {
		const url = new URL(location.href);
		url.search = "";
		url.hash = "";
		if (!together.membership) {
			return;
		}
		url.searchParams.set("room", together.membership.code);
		try {
			await navigator.clipboard.writeText(url.href);
			copied = true;
		} catch {
			together.error = "Copy the invite from the field below.";
		}
	}
	const inviteUrl = $derived(
		together.membership
			? `${page.url.origin}${page.url.pathname}?room=${together.membership.code}`
			: "",
	);
</script>

{#if onPlayer || together.membership || invite}
 <aside class="fixed right-3 top-20 z-50 max-w-[calc(100vw-1.5rem)] text-white sm:top-4" aria-label="Watch together">
  <button type="button" class="min-h-11 rounded-full bg-black/80 px-4 py-2 text-sm shadow-lg ring-1 ring-white/30" aria-expanded={together.panelOpen} onclick={()=>together.panelOpen=!together.panelOpen}>
   {together.membership ? `Watch room · ${together.room?.members.length ?? 1}/2` : "Watch together"}
  </button>
  {#if together.localStream && !together.panelOpen}
   <div class="mt-2 grid w-64 max-w-full grid-cols-2 gap-2 rounded-xl bg-black/90 p-2">
    <video data-testid="local-call" bind:this={localVideo} autoplay muted playsinline class="aspect-video w-full rounded-lg bg-black"></video>
    <video data-testid="remote-call" bind:this={remoteVideo} autoplay playsinline class="aspect-video w-full rounded-lg bg-black"></video>
    <button class="room-button" onclick={()=>together.toggleMic()}>{together.micEnabled?"Mute mic":"Unmute mic"}</button>
    <button class="room-button" onclick={()=>together.endCall()}>Leave call</button>
    {#if remoteBlocked}<button class="room-button col-span-2" onclick={()=>{void remoteVideo?.play().then(()=>{remoteBlocked=false;});}}>Enable call audio</button>{/if}
   </div>
  {/if}
  {#if together.panelOpen}
   <section class="mt-2 max-h-[70dvh] w-80 max-w-full overflow-y-auto rounded-2xl bg-zinc-950/95 p-4 text-sm shadow-xl ring-1 ring-white/20" aria-label="Watch room controls">
    <div class="mb-3 flex items-center justify-between"><h2 class="font-semibold">Watch together</h2><button type="button" aria-label="Close watch room controls" class="min-h-10 min-w-10" onclick={()=>together.panelOpen=false}>✕</button></div>
    {#if !together.membership}
     <label class="block">Your name<input class="mt-1 mb-3 w-full rounded-lg bg-white/10 p-3" maxlength="40" bind:value={name} placeholder="Your name" /></label>
     {#if invite}
      <button class="room-button" disabled={busy} onclick={()=>act(()=>together.join(invite,name||"Guest"))}>Join watch room</button>
     {:else}
      <p class="mb-3 text-white/70">Invite one person to watch in sync. Each viewer uses their own sources.</p>
      <button class="room-button" disabled={busy||!together.media} onclick={()=>act(()=>together.create(name||"Host"))}>Create watch room</button>
     {/if}
    {:else}
     <p role="status" class="mb-2">{together.connected ? together.room?.members.every(m=>m.ready&&m.connected) ? "Ready to watch" : "Waiting for both players to load" : "Reconnecting to the room…"}</p>
     {#if together.room}
      <ul class="mb-3 text-white/70">{#each together.room.members as member (member.id)}<li>{member.name}{member.id===together.room.host?" · host":""} · {member.connected?member.ready?"ready":"loading":"reconnecting"}</li>{/each}</ul>
      <p class="mb-2 break-words text-xs text-white/60">Host's source: {together.room.media.label || "Unknown release"}</p>
     {/if}
     <button class="room-button" onclick={copyInvite}>{copied?"Invite copied":"Copy invite link"}</button>
     <input aria-label="Watch room invite link" readonly value={inviteUrl} class="mt-2 w-full rounded-lg bg-white/10 p-2 text-xs" onclick={(event)=>event.currentTarget.select()} />
     {#if together.mismatch&&!together.acceptedMismatch}
      <p class="mt-3 text-amber-200">Your file has a different running time. Select the same release as the host for accurate sync.</p>
      <button class="room-button mt-2" onclick={()=>together.acceptMismatch()}>Use this version anyway</button>
     {/if}
     <button class="room-button mt-3" disabled={!together.connected} onclick={()=>together.play()}>{together.blocked?"Tap to enable playback":"Play together"}</button>
     {#if !together.localStream}
      <button class="room-button mt-2" disabled={!together.connected} onclick={()=>together.startCall()}>Join video call</button>
      <p class="mt-2 text-xs text-white/60">Camera and microphone start only when you join. Use headphones to avoid movie audio echo.</p>
     {:else}
      <div class="mt-3 grid grid-cols-2 gap-2">
       <div><video data-testid="local-call" bind:this={localVideo} autoplay muted playsinline class="aspect-video w-full rounded-lg bg-black"></video><span class="text-xs">You</span></div>
       <div><video data-testid="remote-call" bind:this={remoteVideo} autoplay playsinline class="aspect-video w-full rounded-lg bg-black"></video><span class="text-xs">{together.peer?.name||"Other viewer"}</span></div>
      </div>
      {#if remoteBlocked}<button class="room-button" onclick={()=>{void remoteVideo?.play().then(()=>{remoteBlocked=false;});}}>Enable call audio</button>{/if}
      <div class="mt-2 flex flex-wrap gap-2"><button class="room-button" aria-pressed={!together.micEnabled} onclick={()=>together.toggleMic()}>{together.micEnabled?"Mute mic":"Unmute mic"}</button><button class="room-button" aria-pressed={!together.cameraEnabled} onclick={()=>together.toggleCamera()}>{together.cameraEnabled?"Camera off":"Camera on"}</button><button class="room-button" onclick={()=>together.endCall()}>Leave call</button></div>
     {/if}
     {#if together.callStatus}<p role="status" class="mt-2 text-xs">Call: {together.callStatus}</p>{/if}
     {#if !together.relayConfigured}<p class="mt-2 text-xs text-white/60">A call relay is not configured. Calls may fail on restricted or mobile networks.</p>{/if}
     <button class="room-button mt-3" onclick={()=>together.leave()}>Leave watch room</button>
    {/if}
    {#if together.error}<p role="alert" class="mt-3 text-amber-200">{together.error}</p>{/if}
   </section>
  {/if}
 </aside>
{/if}
<style>
 .room-button {min-height:44px;border-radius:0.75rem;background:rgb(255 255 255 / 0.12);padding:0.6rem 0.8rem;cursor:pointer;}
 .room-button:disabled {opacity:0.45;cursor:default;}
 .room-button:hover:not(:disabled) {background:rgb(255 255 255 / 0.2);}
</style>
