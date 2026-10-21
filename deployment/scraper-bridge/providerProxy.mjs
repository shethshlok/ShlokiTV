import { resolve4 } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import https from "node:https";
import { isIP } from "node:net";
import process from "node:process";
import { parseProperties } from "./envProperties.mjs";

const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 4;
let active = 0;
let windowStart = 0;
let requests = 0;

export function isPublicIPv4(ip) {
	if (isIP(ip) !== 4) {
		return false;
	}
	const [a, b] = ip.split(".").map(Number);
	return !(
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && (b === 168 || b === 0 || b === 2)) ||
		(a === 198 && (b === 18 || b === 19 || b === 51)) ||
		(a === 203 && b === 0)
	);
}

export function validateTarget(raw, allowed) {
	const url = new URL(raw);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		(url.port && url.port !== "443") ||
		isIP(url.hostname) ||
		!allowed.has(url.hostname)
	) {
		throw new Error("Destination is not allowed");
	}
	return url;
}

export function nextRedirectRequest(input, currentUrl, location, statusCode) {
	const url = new URL(String(location || ""), currentUrl).toString();
	const next = { ...input, url, headers: { ...(input.headers || {}) } };
	if (
		[301, 302, 303].includes(Number(statusCode)) &&
		!["GET", "HEAD"].includes(String(input.method || "GET").toUpperCase())
	) {
		next.method = "GET";
		next.body = "";
		for (const name of Object.keys(next.headers)) {
			if (["content-type", "content-length"].includes(name.toLowerCase())) {
				delete next.headers[name];
			}
		}
	}
	return next;
}

export function providerMethod(value = "GET") {
	const method = String(value).toUpperCase();
	if (!["GET", "POST", "HEAD"].includes(method)) {
		throw new Error("Method is not allowed");
	}
	return method;
}

function providerHeaders(input) {
	const headers = { "accept-encoding": "identity" };
	for (const [key, value] of Object.entries(input.headers || {})) {
		if (
			[
				"accept",
				"accept-language",
				"content-type",
				"cookie",
				"origin",
				"referer",
				"user-agent",
				"x-requested-with",
				"range",
			].includes(key.toLowerCase())
		) {
			if (
				key.toLowerCase() === "range" &&
				!/^bytes=\d*-\d*$/.test(String(value))
			) {
				continue;
			}
			headers[key.toLowerCase()] = String(value).slice(0, 2048);
		}
	}
	return headers;
}

export async function upstream(
	input,
	allowed,
	redirects = 0,
	network = { resolve4, request: https.request },
) {
	const url = validateTarget(input.url, allowed);
	const method = providerMethod(input.method);
	const addresses = await network.resolve4(url.hostname);
	if (!(addresses.length && addresses.every(isPublicIPv4))) {
		throw new Error("Private destination blocked");
	}
	const headers = providerHeaders(input);
	return new Promise((resolve, reject) => {
		const request = network.request(
			url,
			{
				method,
				headers,
				family: 4,
				autoSelectFamily: false,
				// Pin the validated IPv4 address: a second DNS lookup must not bypass validation.
				lookup: (_host, _options, callback) => callback(null, addresses[0], 4),
			},
			(response) => {
				if ([301, 302, 303, 307, 308].includes(Number(response.statusCode))) {
					response.resume();
					if (!response.headers.location) {
						reject(new Error("Provider redirect has no destination"));
						return;
					}
					if (redirects >= MAX_REDIRECTS) {
						reject(new Error("Provider redirect limit exceeded"));
						return;
					}
					const next = nextRedirectRequest(
						input,
						url,
						response.headers.location,
						response.statusCode,
					);
					upstream(next, allowed, redirects + 1, network).then(resolve, reject);
					return;
				}
				const chunks = [];
				let size = 0;
				response.on("data", (chunk) => {
					size += chunk.length;
					if (size > MAX_BYTES) {
						request.destroy(new Error("Response exceeds limit"));
					} else {
						chunks.push(chunk);
					}
				});
				response.on("error", reject);
				response.on("end", () =>
					resolve({
						returnValue: true,
						ok: response.statusCode >= 200 && response.statusCode < 300,
						status: response.statusCode,
						statusText: response.statusMessage,
						url: url.toString(),
						body: Buffer.concat(chunks).toString("utf8"),
						headers: {
							"content-type": response.headers["content-type"] || "",
							"content-length": response.headers["content-length"] || "",
							"content-range": response.headers["content-range"] || "",
							"accept-ranges": response.headers["accept-ranges"] || "",
							"set-cookie": Array.isArray(response.headers["set-cookie"])
								? response.headers["set-cookie"].join("\n")
								: response.headers["set-cookie"] || "",
						},
						truncated: false,
					}),
				);
			},
		);
		// Every redirect is resolved, allowlisted and DNS-pinned again inside upstream().
		const deadline = setTimeout(
			() => request.destroy(new Error("Upstream timeout")),
			15_000,
		);
		request.on("error", reject);
		request.on("close", () => clearTimeout(deadline));
		request.end(method === "POST" ? String(input.body || "") : undefined);
	});
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing legacy HTTP proxy validates configuration, origin, quota and request body.
export async function handleProviderProxy(request, response) {
	// Local server-only config is never included in nuvio.env.js.
	const localConfig = parseProperties(
		await readFile(
			new URL("../local.properties", import.meta.url),
			"utf8",
		).catch(() => ""),
	);
	const config = { ...localConfig, ...process.env };
	const send = (status, data) => {
		response.writeHead(status, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		response.end(JSON.stringify(data));
	};
	const allowed = new Set(
		(config.NUVIO_PROVIDER_ALLOWED_HOSTS || "")
			.split(",")
			.map((x) => x.trim().toLowerCase())
			.filter(Boolean),
	);
	const origins = new Set(
		(config.NUVIO_PROVIDER_ALLOWED_ORIGINS || "")
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean),
	);
	if (
		config.NUVIO_PROVIDER_PROXY_ENABLED !== "true" ||
		!allowed.size ||
		!origins.size
	) {
		return send(503, { error: "Provider proxy is not configured" });
	}
	if (
		request.method !== "POST" ||
		!origins.has(request.headers.origin) ||
		!String(request.headers["content-type"] || "").startsWith(
			"application/json",
		)
	) {
		return send(403, { error: "Request is not allowed" });
	}
	if (Date.now() - windowStart > 60_000) {
		windowStart = Date.now();
		requests = 0;
	}
	if (active >= 64 || ++requests > 600) {
		return send(429, { error: "Provider proxy rate limit" });
	}
	active++;
	const timeout = setTimeout(() => request.destroy(), 20_000);
	try {
		let size = 0;
		const chunks = [];
		for await (const chunk of request) {
			size += chunk.length;
			if (size > MAX_BYTES) {
				throw new Error("Request exceeds limit");
			}
			chunks.push(chunk);
		}
		const result = await upstream(
			JSON.parse(Buffer.concat(chunks).toString("utf8")),
			allowed,
		);
		send(200, result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		const reason =
			message === "Destination is not allowed"
				? "host_not_allowed"
				: message === "Private destination blocked"
					? "private_destination"
					: /exceeds limit/.test(message)
						? "response_too_large"
						: /timeout/i.test(message)
							? "upstream_timeout"
							: "upstream_unavailable";
		send(502, {
			error: "Provider request rejected or upstream unavailable",
			reason,
		});
	} finally {
		clearTimeout(timeout);
		active--;
	}
}
