import process from "node:process";
import { error, json } from "@sveltejs/kit";
import * as v from "valibot";
import { DATABASE } from "#lib/services/index.js";
import { diagnosticsSchema } from "#lib/watch-together/diagnostics.js";
import {
	diagnosticRecord,
	playbackDiagnostics,
} from "#lib/watch-together/diagnostics.server.js";
import { watchRooms } from "#lib/watch-together/rooms.server.js";
import type { RequestHandler } from "./$types";

const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const number = (min: number, max: number) =>
	v.pipe(v.number(), v.finite(), v.minValue(min), v.maxValue(max));
const mediaSchema = v.object({
	type: v.picklist(["movie", "series"]),
	id: v.pipe(text(200), v.nonEmpty()),
	title: text(200),
	label: text(300),
	duration: number(0, 86_400),
	filename: v.optional(v.nullable(text(300))),
	infoHash: v.optional(v.nullable(text(100))),
	fileSize: v.optional(v.nullable(number(0, 1e15))),
});
const bodySchema = v.object({
	action: text(20),
	sample: v.optional(diagnosticsSchema),
	code: v.optional(text(24)),
	member: v.optional(text(24)),
	token: v.optional(text(24)),
	name: v.optional(text(40)),
	media: v.optional(mediaSchema),
	revision: v.optional(number(1, 1e9)),
	position: v.optional(number(0, 86_400)),
	rate: v.optional(number(0.5, 2)),
	ready: v.optional(v.boolean()),
	enabled: v.optional(v.boolean()),
	target: v.optional(text(24)),
	signal: v.optional(
		v.object({
			description: v.optional(
				v.object({ type: v.picklist(["offer", "answer"]), sdp: text(60_000) }),
			),
			candidate: v.optional(
				v.object({
					candidate: text(3000),
					sdpMid: v.optional(v.nullable(text(100))),
					sdpMLineIndex: v.optional(v.nullable(number(0, 100))),
					usernameFragment: v.optional(v.nullable(text(300))),
				}),
			),
		}),
	),
});
const headers = { "cache-control": "no-store" };
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The validated command dispatcher explicitly checks each action before authorization.
export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.session) {
		error(401, "Sign in to ShlokiTV to watch together.");
	}
	if (request.headers.get("origin") !== url.origin) {
		error(403, "Cross-site room requests are forbidden.");
	}
	if (Number(request.headers.get("content-length")) > 70_000) {
		error(413, "Room message is too large.");
	}
	const raw = await request.text();
	if (raw.length > 70_000) {
		error(413, "Room message is too large.");
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		error(400, "Invalid room message.");
	}
	const parsed = v.safeParse(bodySchema, value);
	if (!parsed.success) {
		error(400, "Invalid room message.");
	}
	const b = parsed.output,
		user = locals.session.user.id;
	if (b.action === "create") {
		if (!b.media) {
			error(400, "Choose a movie first.");
		}
		return json(watchRooms.create(user, b.name?.trim() || "Host", b.media), {
			headers,
		});
	}
	if (b.action === "join") {
		if (!b.code) {
			error(400, "Missing invite.");
		}
		return json(watchRooms.join(b.code, user, b.name?.trim() || "Guest"), {
			headers,
		});
	}
	if (!(b.code && b.member && b.token)) {
		error(400, "Missing room membership.");
	}
	if (
		(b.action === "seek" && b.position === undefined) ||
		(b.action === "rate" && b.rate === undefined) ||
		(b.action === "media" && !b.media) ||
		(b.action === "signal" && !(b.signal && b.target))
	) {
		error(400, "Incomplete room command.");
	}
	if (b.action === "diagnostics") {
		if (!b.sample) {
			error(400, "Missing playback measurements.");
		}
		watchRooms.command(b.code, b.member, b.token, user, b);
		const { room } = watchRooms.authorize(b.code, b.member, b.token, user);
		void playbackDiagnostics.write(
			locals.services.get(DATABASE).directory,
			diagnosticRecord(watchRooms.snapshot(room), b.member, b.sample),
		);
		return json({ ok: true, serverTime: Date.now() }, { headers });
	}
	if (b.action === "status") {
		watchRooms.authorize(b.code, b.member, b.token, user);
		return json({ ok: true, serverTime: Date.now() }, { headers });
	}
	watchRooms.command(b.code, b.member, b.token, user, b);
	return json({ ok: true, serverTime: Date.now() }, { headers });
};
export const GET: RequestHandler = ({ request, locals, url }) => {
	if (!locals.session) {
		error(401, "Sign in to ShlokiTV to watch together.");
	}
	const code = url.searchParams.get("code") ?? "",
		id = url.searchParams.get("member") ?? "",
		token = url.searchParams.get("token") ?? "";
	watchRooms.authorize(code, id, token, locals.session.user.id);
	const user = locals.session.user.id;
	let stop: () => void = () => {
			/* Assigned after subscribing. */
		},
		ping: ReturnType<typeof setInterval>;
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const close = () => {
				stop();
				clearInterval(ping);
				request.signal.removeEventListener("abort", close);
				try {
					controller.close();
				} catch {
					/*closed*/
				}
			};
			const send = (event: string, value: unknown) => {
				try {
					controller.enqueue(
						encoder.encode(
							`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
						),
					);
					if (event === "closed" || event === "replaced") {
						queueMicrotask(close);
					}
				} catch {
					close();
				}
			};
			if (request.signal.aborted) {
				controller.close();
				return;
			}
			stop = watchRooms.connect(code, id, token, user, send);
			// RTC configuration stays server-side until an authenticated member connects.
			const iceServerSchema = v.array(
				v.object({
					urls: v.union([v.string(), v.array(v.string())]),
					username: v.optional(v.string()),
					credential: v.optional(v.string()),
				}),
			);
			let iceServers: RTCIceServer[] = [
				{ urls: "stun:stun.cloudflare.com:3478" },
			];
			try {
				const configured = v.safeParse(
					iceServerSchema,
					JSON.parse(process.env.SHLOKITV_ICE_SERVERS ?? "null"),
				);
				if (configured.success) {
					iceServers = configured.output;
				}
			} catch {
				/* Keep direct calls available when configuration is missing or invalid. */
			}

			send("config", {
				iceServers,
				relayConfigured: iceServers.some((s) =>
					[s.urls].flat().some((u) => /^turns?:/.test(u)),
				),
			});
			ping = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": heartbeat\n\n"));
				} catch {
					close();
				}
			}, 15_000);
			request.signal.addEventListener("abort", close);
		},
		cancel() {
			stop();
			clearInterval(ping);
		},
	});
	return new Response(stream, {
		headers: {
			...headers,
			"content-type": "text/event-stream",
			"x-accel-buffering": "no",
		},
	});
};
