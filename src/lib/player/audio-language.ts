/**
 * Which audio track a viewer wants, by language. Pure : the settings decide the
 * preference, the player applies it to whatever track list a source exposes.
 */

// ISO 639-2 bibliographic codes `Intl.Locale` doesn't canonicalise everywhere.
const BIBLIOGRAPHIC: Record<string, string> = {
	alb: "sq",
	arm: "hy",
	baq: "eu",
	bur: "my",
	chi: "zh",
	cze: "cs",
	dut: "nl",
	fre: "fr",
	geo: "ka",
	ger: "de",
	gre: "el",
	ice: "is",
	mac: "mk",
	may: "ms",
	per: "fa",
	rum: "ro",
	slo: "sk",
	tib: "bo",
	wel: "cy",
};

/**
 * A comparable key for a language code in any of the spellings tracks and
 * settings use (`fr`, `fra`, `fre`, `fr-CA`), or null when it names none.
 */
export function languageKey(code: string | null | undefined): string | null {
	const raw = code?.trim().toLowerCase().replace("_", "-");
	if (!raw || raw === "und") {
		return null;
	}
	const primary = raw.split("-")[0];
	if (BIBLIOGRAPHIC[primary]) {
		return BIBLIOGRAPHIC[primary];
	}
	try {
		return new Intl.Locale(primary).language;
	} catch {
		return null;
	}
}

/** The mobile app's non-language choices, stored in the same field. */
const FILE_DEFAULT = "default";
const DEVICE = "device";
const ORIGINAL = "original";

/**
 * Language keys to look for, best first. `preference` is a language code,
 * `device` (the browser's languages), or `default` / `original` / empty, which
 * leave the file's own default alone : the title's original language isn't
 * known here. `secondary` is tried after whatever the preference gave.
 */
export function audioLanguageTargets(
	preference: string | null | undefined,
	secondary: string | null | undefined,
	deviceLanguages: readonly string[],
): string[] {
	const choice = preference?.trim().toLowerCase() ?? "";
	const wanted =
		choice === DEVICE
			? deviceLanguages
			: choice === "" || choice === FILE_DEFAULT || choice === ORIGINAL
				? []
				: [choice];
	const fallback = secondary?.trim().toLowerCase();
	const keys = [
		...wanted,
		...(fallback && ![FILE_DEFAULT, DEVICE, ORIGINAL].includes(fallback)
			? [fallback]
			: []),
	]
		.map(languageKey)
		.filter((key) => key !== null);
	return [...new Set(keys)];
}

/** A room's shared audio pick: a language key, plus the menu label for ties and files with no code. */
export interface SharedAudio {
	language: string | null;
	label: string;
}

/**
 * The choice worth sending to the other viewer, or null when the track names
 * neither a language nor a label.
 */
export function sharedAudioChoice(
	track: { language?: string | null; label?: string | null } | null | undefined,
): SharedAudio | null {
	if (!track) {
		return null;
	}
	const language = languageKey(track.language);
	const label = track.label?.trim().slice(0, 120) ?? "";
	if (!(language || label)) {
		return null;
	}
	return { language, label };
}

/**
 * Track id for a shared choice. Language wins, and an exact label picks among
 * several tracks in that language. A file with no language code matches the label.
 */
export function matchingAudioTrack(
	tracks: ReadonlyArray<{ id: number; label: string; language?: string }>,
	choice: SharedAudio,
): number {
	const label = choice.label.trim().toLowerCase();
	if (choice.language) {
		const same = tracks.filter(
			(track) => languageKey(track.language) === choice.language,
		);
		const exact = label
			? same.find((track) => track.label.trim().toLowerCase() === label)
			: undefined;
		const pick = exact ?? same[0];
		if (pick) {
			return pick.id;
		}
	}
	if (label) {
		const byLabel = tracks.find(
			(track) => track.label.trim().toLowerCase() === label,
		);
		if (byLabel) {
			return byLabel.id;
		}
	}
	return -1;
}

/** Index of the first track in the best-ranked wanted language, or -1. */
export function preferredTrackIndex(
	tracks: ReadonlyArray<{ language: string }>,
	targets: readonly string[],
): number {
	for (const target of targets) {
		const index = tracks.findIndex(
			(track) => languageKey(track.language) === target,
		);
		if (index !== -1) {
			return index;
		}
	}
	return -1;
}

/** Preserve release labels while spelling out the file's declared language. */
export function audioChoiceLabel(
	track: { label: string; language?: string },
	locale = "en",
): string {
	const key = languageKey(track.language);
	if (!key) {
		return track.label;
	}
	try {
		const name = new Intl.DisplayNames([locale], { type: "language" }).of(key);
		if (!name || name === key) {
			return track.label;
		}
		if (
			!track.label ||
			track.label.toLowerCase().includes(name.toLowerCase())
		) {
			return track.label || name;
		}
		return `${name} · ${track.label}`;
	} catch {
		return track.label;
	}
}
