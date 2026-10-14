import type { Membership } from "./types.js";

const ROOM = "shlokitv:watch-room";
const NAME = "shlokitv:watch-name";

/** Per tab, so a second tab never impersonates the same viewer. */
export function saveMembership(membership: Membership | null) {
	try {
		if (membership) {
			sessionStorage.setItem(ROOM, JSON.stringify(membership));
		} else {
			sessionStorage.removeItem(ROOM);
		}
	} catch {
		// Memory still works.
	}
}

export function loadMembership(): Membership | null {
	try {
		const value = JSON.parse(sessionStorage.getItem(ROOM) ?? "null");
		if (
			typeof value?.code === "string" &&
			typeof value.member === "string" &&
			typeof value.token === "string"
		) {
			return value;
		}
	} catch {
		saveMembership(null);
	}
	return null;
}

/** The display name last used in a room, so the next invite is one tap. */
export function rememberedName(): string {
	try {
		return localStorage.getItem(NAME) ?? "";
	} catch {
		return "";
	}
}

export function rememberName(name: string) {
	try {
		if (name.trim()) {
			localStorage.setItem(NAME, name.trim().slice(0, 40));
		}
	} catch {
		// Not remembering a name is harmless.
	}
}
