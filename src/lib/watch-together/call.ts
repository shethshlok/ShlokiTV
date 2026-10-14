// biome-ignore-all lint/suspicious/noUnnecessaryConditions: Browser callbacks mutate these private flags and counters asynchronously; static narrowing cannot track those writes.
import type { CallSignal } from "./types.js";

/** Two-peer perfect negotiation. The guest is polite when offers collide. */
export class WatchCall {
	readonly peer: RTCPeerConnection;
	private makingOffer = false;
	private ignoreOffer = false;
	private settingAnswer = false;
	private readonly candidates: RTCIceCandidateInit[] = [];
	private receiving = Promise.resolve();
	// biome-ignore lint/complexity/useMaxParams: Peer configuration and media callbacks are fixed at construction.
	constructor(
		iceServers: RTCIceServer[],
		private readonly polite: boolean,
		stream: MediaStream,
		private readonly send: (signal: CallSignal) => Promise<void>,
		onStream: (stream: MediaStream) => void,
		onStatus: (value: string) => void,
	) {
		this.peer = new RTCPeerConnection({ iceServers });
		const pc = this.peer;
		for (const track of stream.getTracks()) {
			pc.addTrack(track, stream);
		}
		pc.ontrack = (event) =>
			onStream(event.streams[0] ?? new MediaStream([event.track]));
		pc.onicecandidate = (event) => {
			if (event.candidate) {
				void send({ candidate: event.candidate.toJSON() }).catch(() =>
					onStatus("Call signaling disconnected"),
				);
			}
		};
		pc.onconnectionstatechange = () => {
			onStatus(pc.connectionState);
			if (pc.connectionState === "failed") {
				pc.restartIce();
			}
		};
		pc.onnegotiationneeded = async () => {
			try {
				this.makingOffer = true;
				await pc.setLocalDescription();
				await send({ description: pc.localDescription?.toJSON() });
			} catch {
				onStatus("Call could not connect. Try leaving and rejoining the call.");
			} finally {
				this.makingOffer = false;
			}
		};
	}
	receive(signal: CallSignal) {
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the offer/answer collision rules together, following WebRTC perfect negotiation.
		this.receiving = this.receiving.then(async () => {
			const pc = this.peer;
			if (pc.signalingState === "closed") {
				return;
			}
			if (signal.description) {
				const ready =
					!this.makingOffer &&
					(pc.signalingState === "stable" || this.settingAnswer);
				const collision = signal.description.type === "offer" && !ready;
				this.ignoreOffer = !this.polite && collision;
				if (this.ignoreOffer) {
					return;
				}
				this.settingAnswer = signal.description.type === "answer";
				try {
					await pc.setRemoteDescription(signal.description);
				} finally {
					this.settingAnswer = false;
				}
				for (const candidate of this.candidates.splice(0)) {
					// biome-ignore lint/performance/noAwaitInLoops: ICE candidates must be applied in signaling order.
					await pc.addIceCandidate(candidate);
				}
				if (signal.description.type === "offer") {
					await pc.setLocalDescription();
					await this.send({ description: pc.localDescription?.toJSON() });
				}
			} else if (signal.candidate && !this.ignoreOffer) {
				if (pc.remoteDescription) {
					await pc.addIceCandidate(signal.candidate);
				} else {
					this.candidates.push(signal.candidate);
				}
			}
		});
		return this.receiving;
	}
	close() {
		this.peer.onnegotiationneeded = null;
		this.peer.onicecandidate = null;
		this.peer.onconnectionstatechange = null;
		this.peer.close();
	}
}
