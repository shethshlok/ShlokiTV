export async function lookup(type, id, fetcher = fetch) {
	const parts = id.split(":");
	const namespaced = parts[0] === "tmdb";
	const base = namespaced ? parts[1] : parts[0];
	const rest = parts.slice(namespaced ? 2 : 1);
	if (!(base && (/^\d+$/.test(base) || /^tt\d+$/.test(base)))) {
		throw new Error("Unsupported title ID");
	}
	if (namespaced && !/^\d+$/.test(base)) {
		throw new Error("Unsupported TMDB ID");
	}
	const tmdbId = await resolveTmdb(type, base, fetcher);
	const { season, episode } = type === "series" ? coordinates(rest) : {};
	return {
		tmdbId: String(tmdbId),
		mediaType: type === "series" ? "tv" : "movie",
		season: type === "series" ? season : undefined,
		episode: type === "series" ? episode : undefined,
	};
}

function coordinates(rest) {
	const season = rest.length === 1 ? 1 : Number(rest[0] ?? 1);
	const episode = Number(rest.length === 1 ? rest[0] : (rest[1] ?? 1));
	if (
		rest.length > 2 ||
		!Number.isInteger(season) ||
		season < 0 ||
		!Number.isInteger(episode) ||
		episode < 1
	) {
		throw new Error("Invalid episode ID");
	}
	return { season, episode };
}

async function resolveTmdb(type, base, fetcher) {
	let tmdbId = base;
	if (/^tt/.test(base)) {
		const response = await fetcher(
			`https://v3-cinemeta.strem.io/meta/${type}/${base}.json`,
			{ signal: AbortSignal.timeout(8000) },
		);
		if (!response.ok) {
			throw new Error("Metadata unavailable");
		}
		const { meta } = await response.json();
		tmdbId = meta?.moviedb_id;
		if (!/^\d+$/.test(String(tmdbId))) {
			throw new Error("TMDB ID unavailable");
		}
	}
	return tmdbId;
}
