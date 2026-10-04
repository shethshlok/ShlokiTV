import { getRequestEvent } from "$app/server";
import { NUVIO_SCRAPER_ORIGIN } from "$app/env/private";
import { SESSION } from "#lib/services/index.js";
import { pinnedFetch } from "#lib/server/safe-fetch.js";

// A fixed logical public URL keeps the normal addon host validation intact.
// Only this exact path is mapped to our configured service. Tokens are never
// attached to ordinary addons or to redirects.
const BASE = "https://tv.shloksheth.tech/api/scrapers";
export function scraperAddon() {
	return NUVIO_SCRAPER_ORIGIN ? [{
		url: `${BASE}/manifest.json`, name: "Nuvio native scrapers",
		enabled: true, sort_order: -1,
	}] : [];
}
export function scraperFetch(): typeof fetch {
	const event = getRequestEvent();
	return (async (input, init) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		if (!NUVIO_SCRAPER_ORIGIN || url.origin !== "https://tv.shloksheth.tech" || !url.pathname.startsWith("/api/scrapers/")) {
			return pinnedFetch(input, init);
		}
		const path = url.pathname.slice("/api/scrapers".length);
		if ((init?.method && init.method !== "GET") || !/^\/(manifest\.json|stream\/(movie|series)\/[^/]+\.json)$/.test(path)) {
			throw new Error("Unsupported scraper request");
		}
		const session = await event.locals.services.get(SESSION).read();
		if (!session || event.locals.profileId == null) {
			throw new Error("Sign-in required");
		}
		return fetch(new URL(path, NUVIO_SCRAPER_ORIGIN), {
			method: "GET", redirect: "error", signal: init?.signal,
			headers: {Authorization: `Bearer ${session.access_token}`, "X-Nuvio-Profile": String(event.locals.profileId)},
		});
	}) as typeof fetch;
}
