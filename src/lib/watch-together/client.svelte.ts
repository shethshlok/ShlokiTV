// biome-ignore-all lint/suspicious/noUnnecessaryConditions: Browser callbacks mutate these private flags and counters asynchronously; static narrowing cannot track those writes.

import { WatchCall } from "./call.js";
import { PlaybackReporter, type PlaybackSample } from "./diagnostics.js";
import { loadMembership, saveMembership } from "./membership-store.js";
import { hasPlaybackData } from "./readiness.js";
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
	private mediaSentAt = 0; // A title change's new state may still be in flight.
	private call: WatchCall | null = null;
	private peerId = "";
	private iceServers: RTCIceServer[] = [
		{ urls: "stun:stun.cloudflare.com:3478" },
	];
	private callStarting = false;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private retries = 0;
	get host() {
		return !!this.membership && this.room?.host === this.membership.member;
	}
	get peer() {
		return this.room?.members.find((m) => m.id !== this.membership?.member);
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
	async create(name: string) {
		if (!(this.media && this.video && Number.isFinite(this.video.duration))) {
			throw new Error("Start a playable movie or episode first.");
		}
		await this.leave();
		this.membership = await this.request({
			action: "create",
			name,
			media: { ...this.media, duration: this.video.duration },
			position: this.video.currentTime,
			playing: !this.video.paused,
		});
		saveMembership(this.membership);
		this.connect();
		this.panelOpen = true;
	}
	async join(code: string, name: string) {
		await this.leave();
		this.membership = await this.request({ action: "join", code, name });
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
			this.room = room;
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
			this.connected = false;
			this.stopCall();
			this.reportedReady = undefined;
			this.suppressUntil = performance.now() + 1000;
			this.video?.pause();
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
		this.stopCall();
		saveMembership(this.membership);
		if (this.video) {
			this.video.playbackRate = 1;
		}
		this.reportedReady = undefined;
	}
	attach(video: HTMLVideoElement, media: () => RoomMedia) {
		this.detach();
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
		this.media = media;
		this.tick();
	}
	private tick() {
		const room = this.room,
			video = this.video,
			media = this.media;
		if (!(room && this.connected)) {
			return;
		}
		if (
			this.host &&
			video &&
			media &&
			Number.isFinite(video.duration) &&
			video.duration > 0 &&
			!this.pending &&
			Date.now() - this.mediaSentAt > 3000 &&
			(room.media.id !== media.id ||
				room.media.type !== media.type ||
				room.media.label !== media.label ||
				room.media.title !== media.title ||
				Math.abs(room.media.duration - video.duration) > 0.5)
		) {
			this.mediaSentAt = Date.now();
			void this.command({
				action: "media",
				media: { ...media, duration: video.duration },
			});
			return;
		}
		const same =
			!!media && media.id === room.media.id && media.type === room.media.type;
		this.mismatch =
			!!video &&
			Number.isFinite(video.duration) &&
			room.media.duration > 0 &&
			Math.abs(video.duration - room.media.duration) > 2;
		const ready =
			!!video &&
			same &&
			hasPlaybackData(video) &&
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
			this.media.id !== room.media.id ||
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
						this.room.media.duration || Number.POSITIVE_INFINITY,
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
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
				video: {
					width: { ideal: 320 },
					height: { ideal: 240 },
					facingMode: "user",
				},
			});
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
		for (const track of this.localStream?.getAudioTracks() ?? []) {
			track.enabled = this.micEnabled;
		}
	}
	toggleCamera() {
		this.cameraEnabled = !this.cameraEnabled;
		for (const track of this.localStream?.getVideoTracks() ?? []) {
			track.enabled = this.cameraEnabled;
		}
	}
}
export const together = new WatchTogether();
