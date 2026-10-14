<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import ClapperboardIcon from "@lucide/svelte/icons/clapperboard";
	import CopyIcon from "@lucide/svelte/icons/copy";
	import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
	import PlayIcon from "@lucide/svelte/icons/play";
	import Share2Icon from "@lucide/svelte/icons/share-2";
	import XIcon from "@lucide/svelte/icons/x";
	import { onMount, untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto, replaceState } from "$app/navigation";
	import { page } from "$app/state";
	import { together } from "./client.svelte.js";
	import { rememberedName, rememberName } from "./membership-store.js";
	import {
		holdingForViewers,
		memberStatus,
		roomPath,
		waitingNames,
	} from "./readiness.js";
	import type { RoomPreview } from "./types.js";

	let name = $state("");
	let invite = $state("");
	let preview = $state<RoomPreview | null>(null);
	let previewing = $state(false);
	let busy = $state<"" | "create" | "join" | "leave" | "lobby">("");
	let copied = $state(false);
	let localVideo = $state<HTMLVideoElement | null>(null);
	let remoteVideo = $state<HTMLVideoElement | null>(null);
	let remoteBlocked = $state(false);
	const onPlayer = $derived(page.url.pathname.includes("/player"));
	const self = $derived(together.membership?.member);
	const waiting = $derived(waitingNames(together.room, self));
	const holding = $derived(
		together.connected && holdingForViewers(together.room),
	);
	const titlePath = $derived(roomPath(together.room));
	// The dev harness plays any id, so treat it as the room's title.
	const onTitle = $derived(
		!!titlePath &&
			(page.url.pathname === titlePath ||
				page.url.pathname.startsWith("/dev/")),
	);
	const hostName = $derived(
		together.room?.members.find((m) => m.id === together.room?.host)?.name ??
			"The host",
	);
	const canShare = typeof navigator !== "undefined" && "share" in navigator;
	onMount(() => {
		name = rememberedName();
		return together.initialize();
	});
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
	// Show who sent the invite, and whether it still works, before asking to join.
	$effect(() => {
		const code = invite;
		preview = null;
		if (!code) {
			return;
		}
		previewing = true;
		(together.request({ action: "preview", code }) as Promise<RoomPreview>)
			.then((value) => {
				if (invite === code) {
					preview = value;
				}
			})
			.catch((error: { status?: number; message?: string }) => {
				if (invite !== code) {
					return;
				}
				if (error.status === 404) {
					dropInvite();
					together.error =
						"That invite has expired. Ask for a new link, or start your own room below.";
				}
				// Other failures still let the viewer try joining.
			})
			.finally(() => {
				if (invite === code) {
					previewing = false;
				}
			});
	});
	// Follow the host once per title pick; after that, viewers may browse freely.
	let followed = "";
	$effect(() => {
		const room = together.room,
			path = titlePath;
		if (!(room && path) || page.url.pathname.startsWith("/dev/")) {
			return;
		}
		const pick = `${room.code}:${room.revision}`;
		if (untrack(() => together.host) || followed === pick) {
			return;
		}
		followed = pick;
		if (untrack(() => page.url.pathname) === path) {
			return;
		}
		const host = untrack(() => hostName);
		toast(`${host} picked ${room.media?.title || "something to watch"}`, {
			description: "Opening it for you…",
		});
		void goto(path).catch(() => {
			together.error = "Open the room's title to continue watching.";
		});
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
	async function act(kind: typeof busy, action: () => Promise<void>) {
		busy = kind;
		together.error = "";
		rememberName(name);
		try {
			await action();
			if (kind === "join" || kind === "create") {
				dropInvite();
			}
		} catch (error) {
			const status = (error as { status?: number }).status;
			if (invite && status === 404) {
				dropInvite();
				together.error =
					"That invite has expired. Ask for a new link, or start your own room below.";
			} else {
				together.error =
					error instanceof Error ? error.message : "Unable to join the room";
			}
		} finally {
			busy = "";
		}
	}
	function dropInvite() {
		invite = "";
		preview = null;
		if (!page.url.searchParams.has("room")) {
			return;
		}
		const url = new URL(page.url.href);
		url.searchParams.delete("room");
		try {
			replaceState(url, page.state);
		} catch {
			// The router is not ready; the cleared invite still shows the create form.
		}
	}
	async function shareInvite() {
		try {
			await navigator.share({
				title: "Watch with me on ShlokiTV",
				url: inviteUrl,
			});
		} catch {
			// Dismissed: the link stays in the field below.
		}
	}
	async function copyInvite() {
		if (!inviteUrl) {
			return;
		}
		try {
			await navigator.clipboard.writeText(inviteUrl);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			together.error = "Copy the invite from the field below.";
		}
	}
	// Invites open the room's title when there is one, otherwise the home page.
	const inviteUrl = $derived(
		together.membership
			? `${page.url.origin}${onPlayer && onTitle ? page.url.pathname : (titlePath ?? "/")}?room=${together.membership.code}`
			: "",
	);
	const initials = (value: string) =>
		value
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join("") || "?";
</script>

{#if together.panelOpen || together.localStream}
 <aside class="fixed right-3 top-16 z-50 max-w-[calc(100vw-1.5rem)] text-white sm:top-20" aria-label="Watch together">
  {#if together.localStream && !together.panelOpen}
   <div class="mt-2 grid w-64 max-w-full grid-cols-2 gap-2 rounded-xl bg-black/90 p-2">
    <video data-testid="local-call" bind:this={localVideo} autoplay muted playsinline class="aspect-video w-full rounded-lg bg-black"></video>
    <video data-testid="remote-call" bind:this={remoteVideo} autoplay playsinline class="aspect-video w-full rounded-lg bg-black"></video>
    <button class="room-button" onclick={()=>together.toggleMic()}>{together.micEnabled?"Mute mic":"Unmute mic"}</button>
    <button class="room-button" onclick={()=>together.endCall()}>Leave call</button>
    {#if remoteBlocked}<button class="room-button col-span-2" onclick={()=>{void remoteVideo?.play().then(()=>{remoteBlocked=false;});}}>Enable call audio</button>{/if}
    <button class="room-button col-span-2" onclick={()=>together.panelOpen=true}>Open watch room</button>
   </div>
  {/if}
  {#if together.panelOpen}
   <section id="watch-room-controls" class="mt-2 max-h-[75dvh] w-88 max-w-full overflow-y-auto rounded-2xl bg-zinc-950/95 p-4 text-sm shadow-2xl ring-1 ring-white/15 backdrop-blur" aria-label="Watch room controls" aria-busy={!!busy || previewing || (!!together.membership && !together.room)}>
    <div class="mb-3 flex items-center justify-between gap-2">
     <h2 class="font-semibold">Watch together</h2>
     <div class="flex items-center gap-2">
      {#if together.membership}
       {#if !together.room}
        <span class="pill bg-white/10 text-white/80"><LoaderCircleIcon class="size-3 animate-spin" />Connecting</span>
       {:else if !together.connected}
        <span class="pill bg-amber-400/15 text-amber-200"><LoaderCircleIcon class="size-3 animate-spin" />Reconnecting</span>
       {:else}
        <span class="pill bg-emerald-400/15 text-emerald-300"><span class="size-1.5 rounded-full bg-emerald-400"></span>Live</span>
       {/if}
      {/if}
      <button type="button" aria-label="Close watch room controls" class="flex min-h-10 min-w-10 items-center justify-center rounded-full hover:bg-white/10" onclick={()=>together.panelOpen=false}><XIcon class="size-4" /></button>
     </div>
    </div>

    {#if !together.membership}
     {#if invite}
      <div class="mb-3 rounded-xl bg-white/5 p-3" aria-live="polite">
       {#if previewing}
        <p class="flex items-center gap-2 text-white/70"><LoaderCircleIcon class="size-4 animate-spin" />Checking your invite…</p>
       {:else if preview}
        <p class="font-medium">{preview.host} invited you to watch together</p>
        <p class="mt-1 text-white/60">{preview.title ? `Now watching: ${preview.title}` : "Nothing picked yet. You can choose together once you're in."}</p>
        {#if preview.full}<p class="mt-2 text-amber-200">This room already has two viewers.</p>{/if}
       {:else}
        <p class="font-medium">You're invited to a watch room</p>
       {/if}
      </div>
     {:else}
      <p class="mb-3 text-white/70">
       {together.media ? `Start a room for ${together.media.title || "this title"} and invite one person.` : "Start a room now, invite one person, and pick something together. Whatever either of you plays, the other follows."}
      </p>
     {/if}
     <label class="block text-white/80">Your name<input class="mt-1 mb-3 w-full rounded-lg bg-white/10 p-3 text-white" maxlength="40" bind:value={name} placeholder="Your name" autocomplete="nickname" onkeydown={(event)=>{if(event.key==="Enter"&&!busy){void (invite?act("join",()=>together.join(invite,name||"Guest")):act("create",()=>together.create(name||"Host")));}}} /></label>
     {#if invite}
      <button class="room-button primary w-full" disabled={!!busy||previewing||!!preview?.full} onclick={()=>act("join",()=>together.join(invite,name||"Guest"))}>
       {#if busy==="join"}<LoaderCircleIcon class="size-4 animate-spin" />Joining…{:else}Join watch room{/if}
      </button>
      <button class="room-button mt-2 w-full" disabled={!!busy} onclick={dropInvite}>Start my own room instead</button>
     {:else}
      <button class="room-button primary w-full" disabled={!!busy} onclick={()=>act("create",()=>together.create(name||"Host"))}>
       {#if busy==="create"}<LoaderCircleIcon class="size-4 animate-spin" />Creating…{:else}Create watch room{/if}
      </button>
     {/if}
    {:else if !together.room}
     <div class="space-y-2" aria-hidden="true">
      <div class="h-12 animate-pulse rounded-xl bg-white/10"></div>
      <div class="h-12 animate-pulse rounded-xl bg-white/10"></div>
      <div class="h-16 animate-pulse rounded-xl bg-white/5"></div>
     </div>
     <p role="status" class="mt-3 text-white/70">{together.connected ? "Loading the room…" : "Connecting to the room…"}</p>
    {:else}
     {@const room = together.room}
     <p role="status" class="mb-3">
      {#if !together.connected}Reconnecting to the room…
      {:else if room.members.length < 2}Waiting for someone to join
      {:else if !room.media}Pick something to watch
      {:else if waiting.count}Waiting for {waiting.names} to load
      {:else}Ready to watch{/if}
     </p>
     <ul class="mb-3 space-y-1.5" aria-label="Viewers">
      {#each room.members as member (member.id)}
       {@const status = memberStatus(member, room)}
       <li class="flex items-center gap-3 rounded-xl bg-white/5 p-2">
        <span class="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold" aria-hidden="true">
         {initials(member.name)}
         <span class={["absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-zinc-950", status==="ready"?"bg-emerald-400":status==="here"?"bg-sky-400":status==="loading"?"bg-amber-400":"bg-white/40"]}></span>
        </span>
        <span class="min-w-0 flex-1 truncate">{member.name}{member.id===self?" (you)":""}</span>
        <span class="shrink-0 text-xs text-white/60">{member.id===room.host&&room.media?"host · ":""}{status==="ready"?"ready":status==="here"?"connected":status==="loading"?"loading":"reconnecting"}</span>
       </li>
      {/each}
      {#if room.members.length < 2}
       <li class="flex items-center gap-3 rounded-xl border border-dashed border-white/15 p-2 text-white/50">
        <span class="flex size-8 items-center justify-center rounded-full border border-dashed border-white/25 text-xs" aria-hidden="true">+</span>
        Invite someone with the link below
       </li>
      {/if}
     </ul>

     <div class="mb-3 rounded-xl bg-white/5 p-3">
      {#if room.media}
       <p class="flex items-center gap-2 text-xs tracking-wide text-white/50 uppercase"><ClapperboardIcon class="size-3.5" />Now watching</p>
       <p class="mt-1 font-medium">{room.media.title || "Untitled"}</p>
       <p class="mt-1 wrap-break-word text-xs text-white/60">Host's source: {room.media.label || "Unknown release"}</p>
       {#if room.rate !== 1}<p class="mt-2 text-amber-200">Room speed: {room.rate}× for everyone. Change it from the speed menu.</p>{/if}
       {#if !onTitle && titlePath}
        <button class="room-button primary mt-3 w-full" onclick={()=>void goto(titlePath)}><PlayIcon class="size-4" />Go to {room.media.title || "the title"}</button>
       {/if}
      {:else}
       <p class="flex items-center gap-2 text-xs tracking-wide text-white/50 uppercase"><ClapperboardIcon class="size-3.5" />Nothing picked yet</p>
       <p class="mt-1 text-white/70">Open any movie or episode and press play. Everyone in the room follows.</p>
      {/if}
     </div>

     <div class="flex gap-2">
      <button class="room-button flex-1" onclick={copyInvite}>{#if copied}<CheckIcon class="size-4" />Invite copied{:else}<CopyIcon class="size-4" />Copy invite link{/if}</button>
      {#if canShare}<button class="room-button" onclick={shareInvite}><Share2Icon class="size-4" />Share invite</button>{/if}
     </div>
     <input aria-label="Watch room invite link" readonly value={inviteUrl} class="mt-2 w-full rounded-lg bg-white/10 p-2 text-xs text-white/70" onclick={(event)=>event.currentTarget.select()} />

     {#if room.media && onTitle}
      {#if together.mismatch&&!together.acceptedMismatch}
       <p class="mt-3 text-amber-200">Your file has a different running time. Select the same release as the host for accurate sync.</p>
       <button class="room-button mt-2 w-full" onclick={()=>together.acceptMismatch()}>Use this version anyway</button>
      {/if}
      <button class="room-button primary mt-3 w-full" disabled={!together.connected} onclick={()=>together.play()}>
       {#if together.blocked}Tap to enable playback
       {:else if holding}<LoaderCircleIcon class="size-4 animate-spin" />Starting when {waiting.names} {waiting.count===1?"is":"are"} ready…
       {:else}Play together{/if}
      </button>
     {/if}

     <div class="mt-3 border-t border-white/10 pt-3">
      {#if !together.localStream}
       <button class="room-button w-full" disabled={!together.connected||together.callStarting} onclick={()=>together.startCall()}>{#if together.callStarting}<LoaderCircleIcon class="size-4 animate-spin" />Starting call…{:else}Join video call{/if}</button>
       <p class="mt-2 text-xs text-white/60">Camera and microphone start only when you join. Use headphones to avoid movie audio echo.</p>
      {:else}
       <div class="grid grid-cols-2 gap-2">
        <div><video data-testid="local-call" bind:this={localVideo} autoplay muted playsinline class="aspect-video w-full rounded-lg bg-black"></video><span class="text-xs">You</span></div>
        <div><video data-testid="remote-call" bind:this={remoteVideo} autoplay playsinline class="aspect-video w-full rounded-lg bg-black"></video><span class="text-xs">{together.peer?.name||"Other viewer"}</span></div>
       </div>
       {#if remoteBlocked}<button class="room-button w-full" onclick={()=>{void remoteVideo?.play().then(()=>{remoteBlocked=false;});}}>Enable call audio</button>{/if}
       <div class="mt-2 flex flex-wrap gap-2"><button class="room-button" aria-pressed={!together.micEnabled} onclick={()=>together.toggleMic()}>{together.micEnabled?"Mute mic":"Unmute mic"}</button><button class="room-button" aria-pressed={!together.cameraEnabled} onclick={()=>together.toggleCamera()}>{together.cameraEnabled?"Camera off":"Camera on"}</button><button class="room-button" onclick={()=>together.endCall()}>Leave call</button></div>
      {/if}
      {#if together.callStatus}<p role="status" class="mt-2 text-xs">Call: {together.callStatus}</p>{/if}
      {#if !together.relayConfigured}<p class="mt-2 text-xs text-white/60">A call relay is not configured. Calls may fail on restricted or mobile networks.</p>{/if}
     </div>

     <div class="mt-3 flex flex-wrap gap-2">
      {#if together.host && room.media}
       <button class="room-button flex-1" disabled={!together.connected||!!busy} onclick={()=>act("lobby",()=>together.backToLobby())}>{#if busy==="lobby"}<LoaderCircleIcon class="size-4 animate-spin" />{/if}Pick something else</button>
      {/if}
      <button class="room-button flex-1" disabled={!!busy} onclick={()=>act("leave",()=>together.leave())}>{#if busy==="leave"}<LoaderCircleIcon class="size-4 animate-spin" />Leaving…{:else}Leave watch room{/if}</button>
     </div>
    {/if}
    {#if together.error}<p role="alert" class="mt-3 text-amber-200">{together.error}</p>{/if}
   </section>
  {/if}
 </aside>
{/if}
<style>
 .room-button {display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;min-height:44px;border-radius:0.75rem;background:rgb(255 255 255 / 0.12);padding:0.6rem 0.8rem;cursor:pointer;}
 .room-button.primary {background:rgb(255 255 255 / 0.92);color:rgb(9 9 11);font-weight:600;}
 .room-button.primary:hover:not(:disabled) {background:rgb(255 255 255);}
 .room-button:disabled {opacity:0.45;cursor:default;}
 .room-button:hover:not(:disabled):not(.primary) {background:rgb(255 255 255 / 0.2);}
 .pill {display:inline-flex;align-items:center;gap:0.35rem;border-radius:9999px;padding:0.2rem 0.55rem;font-size:0.7rem;font-weight:500;}
</style>
