import { sourceIsUsable } from "./source-validation.mjs";

function sourceHints(result) {
	const hints = {};
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
	if (
		typeof result.url !== "string" ||
		!result.url.startsWith("https://") ||
		!(await usable(result.url))
	) {
		return null;
	}
	const hints = sourceHints(result);
	return {
		url: result.url,
		name: result.name || scraper.name || scraper.id,
		title: result.title || result.quality || scraper.name,
		...(typeof result.description === "string"
			? { description: result.description }
			: {}),
		...(Object.keys(hints).length ? { behaviorHints: hints } : {}),
	};
}

export function sourceKey(stream) {
	return stream.url;
}

// Publish each checked link as soon as it is ready. A slow DNS lookup for
// another link from the same provider must not delay already usable sources.
export async function collectSources(
	results,
	scraper,
	streams,
	usable = sourceIsUsable,
) {
	await Promise.all(
		results.map(async (result) => {
			const stream = await normalizeSource(result, scraper, usable);
			if (
				stream &&
				!streams.some((item) => sourceKey(item) === sourceKey(stream))
			) {
				streams.push(stream);
			}
		}),
	);
}
