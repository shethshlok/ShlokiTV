// biome-ignore-all lint/suspicious/noUnnecessaryConditions: Browser callbacks mutate these private flags and counters asynchronously; static narrowing cannot track those writes.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: Playback, the call, and shared audio share one command queue.

import { sharedAudioChoice } from "#lib/player/audio-language.js";
import { openCamera, setTracks, WatchCall } from "./call.js";
import { PlaybackReporter, type PlaybackSample } from "./diagnostics.js";
import { loadMembership, saveMembership } from "./membership-store.js";
import {
	hasPlaybackData,
	sameTitle,
	steadyReadiness,
	titleUpdate,
} from "./readiness.js";
import {
	type CallSignal,
	type Membership,
	type RoomMedia,
	type RoomSnapshot,
	roomPosition,
	syncAdjustment,
} from "./types.js";

const ignore = () => {
	/* Keep the command queue usable after a completed request. */
};

class WatchTogether {
	membership = $state<Membership | null>(null);
	room = $state<RoomSnapshot | null>(null);
	connected = $state(false);
	error = $state("");
	blocked = $state(false);
	mismatch = $state(false);
	acceptedMismatch = $state(false);
	panelOpen = $state(false);
	localStream = $state<MediaStream | null>(null);
	remoteStream = $state<MediaStream | null>(null);
	callStatus = $state("");
	relayConfigured = $state(false);
	micEnabled = $state(true);
	cameraEnabled = $state(true);
	media = $state<RoomMedia | null>(null);
	private video: HTMLVideoElement | null = null;
	private events: EventSource | null = null;
	private detach: () => void = () => {
		/* No player attached yet. */
	};
	private timer: ReturnType<typeof setInterval> | undefined;
	private suppressUntil = 0;
	private offset = 0;
	private heartbeatAt = 0;
	private readonly diagnostics = new PlaybackReporter((body) =>
		this.request(body),
	);
	private unlocking = false;
	private pending = 0;
	private queue = Promise.resolve();
	private reportedReady: boolean | undefined;
	private stalledAt = 0;
	/** The track this viewer just picked, until the room confirms it. */
	chosenAudio = $state<RoomSnapshot["audio"]>(null);
	private mediaSentAt = 0; // A title change's new state may still be in flight.
	private call: WatchCall | null = null;
	private peerId = "";
	private iceServers: RTCIceServer[] = [
		{ urls: "stun:stun.cloudflare.com:3478" },
	];
	callStarting = $state(false);
	private retry: ReturnType<typeof setTimeout> | undefined;
	private retries = 0;
	/** A player still open when the room went back to the lobby; it must not re-pick its title. */
	private stale: HTMLVideoElement | null = null;
	// Joining while another title plays: that player must not take the room over.
	private joining = false;
	get host() {
		return !!this.membership && this.room?.host === this.membership.member;
	}
	get peer() {
		return this.room?.members.find((m) => m.id !== this.membership?.member);
	}
	/** Room audio, with this viewer's pick winning until the server agrees. */
	get sharedAudio() {
		return this.chosenAudio ?? this.room?.audio ?? null;
	}
	async request(body: Record<string, unknown>) {
		const sent = Date.now();
		const response = await fetch("/api/watch-together", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(8000),
		});
		const data = await response.json();
		if (body.action !== "diagnostics") {
			this.diagnostics.rttMs = Date.now() - sent;
		}
		if (!response.ok) {
			const error = new Error(
				data.message ?? "The room request failed.",
			) as Error & { status: number };
			error.status = response.status;
			throw error;
		}
		if (body.action !== "diagnostics" && typeof data.serverTime === "number") {
			this.offset = data.serverTime - (sent + Date.now()) / 2;
		}
		return data;
	}
	command(body: Record<string, unknown>) {
		const membership = this.membership;
		if (!membership) {
			return Promise.resolve();
		}
		const revision = this.room?.revision;
		this.pending++;
		const work = this.queue.then(() =>
			this.request({ ...membership, revision, ...body }),
		);
		this.queue = work.then(ignore, ignore);
		return work
			.then(ignore, (error) => {
				if (body.action === "audio" && this.chosenAudio === body.audio) {
					this.chosenAudio = null;
				}
				if (membership !== this.membership) {
					return;
				}
				if ([403, 404].includes(error.status)) {
					this.lost(error.message);
				} else {
					this.error = error.message;
				}
			})
			.finally(() => {
				this.pending--;
				if (!this.pending) {
					this.tick();
				}
			});
	}
	initialize() {
		this.restore();
		const offline = () => this.suspend();
		const online = () => {
			if (this.membership) {
				this.connect();
			}
		};
		window.addEventListener("offline", offline);
		window.addEventListener("online", online);
		return () => {
			window.removeEventListener("offline", offline);
			window.removeEventListener("online", online);
			this.suspend();
		};
	}
	private suspend() {
		clearTimeout(this.retry);
		this.events?.close();
		this.events = null;
		clearInterval(this.timer);
		this.hold();
	}
	/** Stop playing and calling until the room is back. */
	private hold() {
		this.connected = false;
		this.stopCall();
		this.reportedReady = undefined;
		this.suppressUntil = performance.now() + 1000;
		this.video?.pause();
	}
	restore() {
		this.membership = loadMembership();
		this.connect();
	}
	/** Starts with the open title, or as a lobby when nothing is playing. */
	async create(name: string) {
		const video = this.video,
			media = this.media;
		const playable =
			!!video &&
			!!media &&
			Number.isFinite(video.duration) &&
			video.duration > 0;
		await this.leave();
		this.membership = await this.request({
			action: "create",
			name,
			...(playable
				? {
						media: { ...media, duration: video.duration },
						position: video.currentTime,
						playing: !video.paused,
					}
				: {}),
		});
		saveMembership(this.membership);
		this.connect();
		this.panelOpen = true;
	}
	async join(code: string, name: string) {
		await this.leave();
		this.membership = await this.request({ action: "join", code, name });
		this.joining = true;
		saveMembership(this.membership);
		this.connect();
		this.panelOpen = true;
	}
	private connect() {
		this.events?.close();
		clearInterval(this.timer);
		this.room = null;
		this.error = "";
		this.reportedReady = undefined;
		if (!this.membership) {
			return;
		}
		const events = new EventSource(
			`/api/watch-together?${new URLSearchParams({ ...this.membership })}`,
		);
		this.events = events;
		events.addEventListener("state", (event) => {
			const room = JSON.parse((event as MessageEvent).data) as RoomSnapshot;
			if (this.room && room.sequence < this.room.sequence) {
				return;
			}
			const changed = this.room?.revision !== room.revision;
			this.retire(room, changed);
			this.room = room;
			if (
				this.chosenAudio &&
				room.audio?.language === this.chosenAudio.language &&
				room.audio.label === this.chosenAudio.label
			) {
				this.chosenAudio = null;
			}
			this.diagnostics.stateReceivedAt = Date.now();
			this.connected = true;
			this.retries = 0;
			if (changed) {
				this.acceptedMismatch = false;
				this.reportedReady = undefined;
			}
			this.tick();
			this.manageCall();
		});
		events.addEventListener("config", (event) => {
			const config = JSON.parse((event as MessageEvent).data);
			this.iceServers = config.iceServers;
			this.relayConfigured = config.relayConfigured;
		});
		events.addEventListener("signal", (event) => {
			const message = JSON.parse((event as MessageEvent).data) as {
				from: string;
				signal: CallSignal;
			};
			if (message.from === this.peerId) {
				void this.call?.receive(message.signal).catch(() => {
					this.callStatus =
						"Call negotiation failed. Leave and rejoin the call.";
				});
			}
		});
		for (const type of ["closed", "replaced"]) {
			events.addEventListener(type, () => {
				if (this.events === events) {
					this.lost(
						type === "replaced"
							? "This room was opened in another tab."
							: "The watch room has ended. Create a new room to keep watching together.",
					);
				}
			});
		}
		events.onerror = () => {
			const membership = this.membership;
			if (membership) {
				void this.request({ ...membership, action: "status" }).catch(
					(error) => {
						if (
							this.membership === membership &&
							[401, 403, 404].includes(error.status)
						) {
							this.lost(error.message);
						}
					},
				);
			}
			this.hold();
			// A 5xx while the server restarts closes the stream for good: reopen it.
			if (events.readyState === EventSource.CLOSED && membership) {
				clearTimeout(this.retry);
				this.retry = setTimeout(
					() => {
						if (this.membership === membership && this.events === events) {
							this.connect();
						}
					},
					Math.min(15_000, 1000 * 2 ** this.retries++),
				);
			}
		};
		this.timer = setInterval(() => this.tick(), 1000);
	}
	async leave() {
		const membership = this.membership;
		this.clear();
		if (membership) {
			await this.request({ ...membership, action: "leave" }).catch(() => {
				/* Already expired or disconnected. */
			});
		}
	}
	/** The room is gone for good: drop it, say why, and offer a new one. */
	private lost(message: string) {
		this.clear();
		this.error = message;
		this.panelOpen = true;
	}
	private clear() {
		clearTimeout(this.retry);
		this.retries = 0;
		this.events?.close();
		this.events = null;
		clearInterval(this.timer);
		this.connected = false;
		this.unlocking = false;
		this.membership = null;
		this.room = null;
		this.chosenAudio = null;
		this.stopCall();
		saveMembership(this.membership);
		if (this.video) {
			this.video.playbackRate = 1;
		}
		this.reportedReady = undefined;
	}
	attach(video: HTMLVideoElement, media: () => RoomMedia) {
		this.detach();
		this.stale = null;
		this.video = video;
		this.media = media();
		this.reportedReady = undefined;
		const handlers: Record<string, () => void> = {};
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Ignore room-generated events while preserving genuine user controls during drift correction.
		const local = (action: string) => {
			if (
				!(this.room && this.connected) ||
				this.pending ||
				this.unlocking ||
				this.reportedReady !== true ||
				this.video !== video ||
				(video.seeking && action !== "seek")
			) {
				return;
			}
			if (performance.now() < this.suppressUntil) {
				if (
					(action === "play" && this.room.playing) ||
					(action === "pause" && !this.room.playing)
				) {
					return;
				}
				if (
					action === "seek" &&
					Math.abs(
						video.currentTime -
							roomPosition(this.room, Date.now() + this.offset),
					) < 0.5
				) {
					return;
				}
				if (action === "rate") {
					return;
				}
			}
			if (
				action === "rate" &&
				Math.abs(video.playbackRate - this.room.rate) < 0.06
			) {
				return;
			}
			void this.command({
				action,
				position: video.currentTime,
				...(action === "rate" ? { rate: video.playbackRate } : {}),
			});
		};
		for (const [event, action] of Object.entries({
			play: "play",
			pause: "pause",
			seeked: "seek",
			ratechange: "rate",
		})) {
			handlers[event] = () => local(action);
		}
		for (const event of [
			"loadedmetadata",
			"canplay",
			"playing",
			"waiting",
			"emptied",
			"error",
		]) {
			handlers[event] = () => {
				if (event === "waiting") {
					this.diagnostic("buffering");
				}
				if (event === "emptied") {
					this.diagnostic("source-reset");
				}
				this.tick();
			};
		}
		for (const [event, handler] of Object.entries(handlers)) {
			video.addEventListener(event, handler);
		}
		this.detach = () => {
			for (const [event, handler] of Object.entries(handlers)) {
				video.removeEventListener(event, handler);
			}
			if (this.video === video) {
				this.video = null;
				this.media = null;
				this.reportedReady = undefined;
				if (this.room) {
					void this.command({ action: "ready", ready: false });
				}
			}
			video.playbackRate = 1;
		};
		this.tick();
		return this.detach;
	}
	updateMedia(media: RoomMedia) {
		if (media.id !== this.media?.id || media.type !== this.media.type) {
			this.stale = null;
		}
		this.media = media;
		this.tick();
	}
	/**
	 * The room moved on (back to the lobby, or the other viewer picked another
	 * title): the open player must not pick its old title back. Our own pick
	 * can confirm after we already moved on, so it never retires us. A
	 * reconnect (page load) is not a move: a newly opened title may pick.
	 */
	private retire(next: RoomSnapshot, changed: boolean) {
		const left = !!this.room?.media && !next.media;
		const moved = this.room ? changed : this.joining;
		this.joining = false;
		const replaced =
			moved &&
			!!next.media &&
			!!this.media &&
			next.host !== this.membership?.member &&
			!sameTitle(this.media, next.media);
		if (left || replaced) {
			this.stale = this.video;
			this.stale?.pause();
		}
	}
	/** Anyone may pick a new title; only its picker refines it. */
	private mayPick(room: RoomSnapshot, media: RoomMedia | null) {
		return (
			!this.pending &&
			Date.now() - this.mediaSentAt > 3000 &&
			this.video !== this.stale &&
			(this.host || !(media && room.media && sameTitle(media, room.media)))
		);
	}
	private tick() {
		const room = this.room,
			video = this.video,
			media = this.media;
		if (!(room && this.connected)) {
			return;
		}
		const update = this.mayPick(room, media) && titleUpdate(room, media, video);
		if (update) {
			this.mediaSentAt = Date.now();
			void this.command({ action: "media", ...update });
			return;
		}
		const same = !!(media && room.media && sameTitle(media, room.media));
		this.mismatch =
			!!video &&
			!!room.media &&
			Number.isFinite(video.duration) &&
			room.media.duration > 0 &&
			Math.abs(video.duration - room.media.duration) > 2;
		const steady = steadyReadiness({
			hasData: !!video && hasPlaybackData(video),
			wasReady: this.reportedReady === true,
			stalledAt: this.stalledAt,
			now: Date.now(),
		});
		this.stalledAt = steady.stalledAt;
		const ready =
			!!video &&
			same &&
			steady.ready &&
			!this.blocked &&
			!video.error &&
			(!this.mismatch || this.acceptedMismatch);
		if (ready !== this.reportedReady && !this.pending) {
			this.reportedReady = ready;
			void this.command({ action: "ready", ready });
		}
		if (Date.now() - this.heartbeatAt > 10_000 && !this.pending) {
			this.heartbeatAt = Date.now();
			void this.command({ action: "heartbeat", ready });
		}
		this.apply();
		if (Date.now() - this.diagnostics.at >= 10_000) {
			this.diagnostic("sample");
		}
	}
	private apply() {
		const video = this.video,
			room = this.room;
		if (
			!(video && room && this.connected) ||
			this.pending ||
			!this.media ||
			this.media.id !== room.media?.id ||
			this.media.type !== room.media.type
		) {
			return;
		}
		this.suppressUntil = performance.now() + 700;
		// A remote pause must also cancel a pending mobile play() promise.
		if (!room.requestedPlaying) {
			this.unlocking = false;
			if (!video.paused) {
				video.pause();
			}
		}
		if (this.unlocking || !hasPlaybackData(video)) {
			return;
		}
		if (this.mismatch && !this.acceptedMismatch) {
			video.pause();
			return;
		}
		this.alignVideo(video, room);
	}
	private alignVideo(video: HTMLVideoElement, room: RoomSnapshot) {
		const target = roomPosition(room, Date.now() + this.offset);
		const gap = target - video.currentTime;
		const adjustment = syncAdjustment(gap, room.rate);
		if (
			((!room.playing && Math.abs(gap) > 0.15) || adjustment.seek) &&
			!video.seeking
		) {
			this.diagnostic("drift-correction");
			video.currentTime = target;
		}
		video.playbackRate = room.playing ? adjustment.rate : room.rate;
		if (room.playing && video.paused && !this.blocked) {
			void video.play().catch(() => {
				this.blocked = true;
			});
		}
		if (!(room.playing || video.paused)) {
			video.pause();
		}
	}
	togglePlayback() {
		if (!(this.room && this.connected)) {
			return;
		}
		if (this.video?.paused || this.video?.ended || this.blocked) {
			void this.play();
			return;
		}
		void this.command({
			action: "pause",
			position: roomPosition(this.room, Date.now() + this.offset),
		});
	}

	seekTo(position: number) {
		if (this.room) {
			void this.command({
				action: "seek",
				position: Math.max(
					0,
					Math.min(
						this.room.media?.duration || Number.POSITIVE_INFINITY,
						position,
					),
				),
			});
		}
	}
	setRate(rate: number) {
		if (this.room) {
			void this.command({ action: "rate", rate });
		}
	}
	/** Tell the room which audio track this viewer picked. The other player matches it on their own file. */
	setAudio(track: { language?: string | null; label?: string | null }) {
		if (!this.room) {
			return;
		}
		const audio = sharedAudioChoice(track);
		if (!audio) {
			return;
		}
		const current = this.sharedAudio;
		if (current?.language === audio.language && current.label === audio.label) {
			return;
		}
		this.chosenAudio = audio;
		void this.command({ action: "audio", audio });
	}
	async play() {
		const video = this.video;
		if (!(video && this.connected) || this.unlocking) {
			return;
		}
		const position = video.ended
			? 0
			: this.room
				? roomPosition(this.room, Date.now() + this.offset)
				: video.currentTime;
		this.diagnostic("play-tap");
		this.blocked = false;
		this.unlocking = true;
		this.suppressUntil = performance.now() + 700;
		try {
			// Start within the tap and publish immediately. Waiting for play() before signaling
			// can deadlock when another viewer is buffering and the shared clock is paused.
			const started = video.play();
			await Promise.all([started, this.command({ action: "play", position })]);
			this.diagnostic("play-started");
		} catch {
			this.blocked = this.room?.requestedPlaying === true && video.paused;
			this.diagnostic("play-blocked");
		} finally {
			this.unlocking = false;
			this.tick();
		}
	}

	private diagnostic(event: PlaybackSample["event"]) {
		this.diagnostics.report({
			event,
			membership: this.membership,
			room: this.room,
			video: this.video,
			connected: this.connected,
			offset: this.offset,
			blocked: this.blocked,
			mismatch: this.mismatch,
		});
	}

	/** Host only: stop the title and go back to choosing one together. */
	async backToLobby() {
		this.stale = this.video;
		this.video?.pause();
		await this.command({ action: "media", media: null });
	}
	acceptMismatch() {
		this.acceptedMismatch = true;
		this.tick();
	}
	async startCall() {
		if (this.callStarting || this.localStream) {
			return;
		}
		this.callStarting = true;
		this.callStatus = "Requesting camera and microphone";
		try {
			const membership = this.membership;
			const stream = await openCamera();
			if (!this.connected || this.membership !== membership) {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				return;
			}
			this.localStream = stream;
			this.micEnabled = true;
			this.cameraEnabled = true;
			this.callStatus = "Waiting for the other viewer";
			await this.command({ action: "call", enabled: true });
			this.manageCall();
		} catch (error) {
			this.callStatus =
				error instanceof Error
					? error.message
					: "Camera or microphone unavailable";
		} finally {
			this.callStarting = false;
		}
	}
	private manageCall() {
		const peer = this.peer;
		if (!(this.localStream && peer?.call && peer.connected)) {
			this.call?.close();
			this.call = null;
			this.peerId = "";
			this.remoteStream = null;
			if (this.localStream) {
				this.callStatus = "Waiting for the other viewer";
			}
			return;
		}
		if (this.call && this.peerId === peer.id) {
			return;
		}
		this.call?.close();
		this.peerId = peer.id;
		this.callStatus = "Connecting";
		this.call = new WatchCall(
			this.iceServers,
			!this.host,
			this.localStream,
			(signal) => this.command({ action: "signal", target: peer.id, signal }),
			(stream) => {
				this.remoteStream = stream;
			},
			(status) => {
				this.callStatus = status;
			},
		);
	}
	stopCall() {
		this.call?.close();
		this.call = null;
		this.peerId = "";
		for (const track of this.localStream?.getTracks() ?? []) {
			track.stop();
		}
		this.localStream = null;
		this.remoteStream = null;
		this.callStatus = "";
	}
	async endCall() {
		this.stopCall();
		await this.command({ action: "call", enabled: false });
	}
	toggleMic() {
		this.micEnabled = !this.micEnabled;
		setTracks(this.localStream?.getAudioTracks(), this.micEnabled);
	}
	toggleCamera() {
		this.cameraEnabled = !this.cameraEnabled;
		setTracks(this.localStream?.getVideoTracks(), this.cameraEnabled);
	}
}
export const together = new WatchTogether();
