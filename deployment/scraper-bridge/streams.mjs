import { sourceIsUsable } from "./source-validation.mjs";

const INFO_HASH = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i;

// The Stremio contract represents torrents as infoHash, not as an HTTP URL.
// The existing UI then offers a torrent-app handoff rather than browser play.
function validHash(value) {
	return typeof value === "string" && INFO_HASH.test(value)
		? value.toLowerCase()
		: null;
}

async function sourceAddress(result, usable) {
	if (typeof result.url !== "string") {
		const infoHash = validHash(result.infoHash);
		return infoHash ? { infoHash } : null;
	}
	let parsed;
	try {
		parsed = new URL(result.url);
	} catch {
		return null;
	}
	if (parsed.protocol === "magnet:") {
		const hash = parsed.searchParams
			.getAll("xt")
			.find((value) => /^urn:btih:/i.test(value))
			?.slice(9);
		const infoHash = validHash(hash);
		return infoHash ? { infoHash } : null;
	}
	return (await usable(result.url)) ? { url: result.url } : null;
}

function sourceHints(result, address) {
	const hints = address.infoHash ? { notWebReady: true } : {};
	if (result.headers && typeof result.headers === "object") {
		hints.proxyHeaders = { request: result.headers };
	}
	if (typeof result.filename === "string") {
		hints.filename = result.filename;
	}
	if (Number.isFinite(result.size) && result.size > 0) {
		hints.videoSize = result.size;
	}
	return hints;
}

export async function normalizeSource(
	result,
	scraper,
	usable = sourceIsUsable,
) {
	if (!result || typeof result !== "object") {
		return null;
	}
	const address = await sourceAddress(result, usable);
	if (!address) {
		return null;
	}
	const hints = sourceHints(result, address);
	return {
		...address,
		...(Number.isInteger(result.fileIdx) && result.fileIdx >= 0
			? { fileIdx: result.fileIdx }
			: {}),
		name: result.name || scraper.name || scraper.id,
		title: result.title || result.quality || scraper.name,
		...(typeof result.description === "string"
			? { description: result.description }
			: {}),
		...(Object.keys(hints).length ? { behaviorHints: hints } : {}),
	};
}

export function sourceKey(stream) {
	return stream.url || `${stream.infoHash}:${stream.fileIdx ?? ""}`;
}
