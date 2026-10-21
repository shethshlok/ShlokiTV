const EPISODE_TAG =
	/\bS(\d{1,2})[ ._-]?E(\d{1,3})(?:[ ._-]*-?[ ._-]*E(\d{1,3}))?/gi;

/**
 * False when a stream's text names episodes and none is the one asked for.
 * Some providers answer one episode with every file in the season folder.
 * Untagged streams pass: most providers never repeat the episode in a label.
 */
export function namesRequestedEpisode(
	videoId: string,
	texts: Array<string | null | undefined>,
): boolean {
	const parts = videoId.split(":");
	const offset = /^[a-z]+$/i.test(parts[0]) ? 2 : 1;
	const rest = parts.slice(offset).map(Number);
	const [season, episode] = rest.length === 1 ? [1, rest[0]] : rest;
	if (!(Number.isInteger(season) && Number.isInteger(episode))) {
		return true;
	}
	let tagged = false;
	for (const text of texts) {
		for (const match of (text ?? "").matchAll(EPISODE_TAG)) {
			tagged = true;
			const first = Number(match[2]);
			const last = match[3] ? Number(match[3]) : first;
			if (Number(match[1]) === season && first <= episode && episode <= last) {
				return true;
			}
		}
	}
	return !tagged;
}
