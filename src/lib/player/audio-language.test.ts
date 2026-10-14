import { describe, expect, it } from "vitest";
import {
	audioChoiceLabel,
	audioLanguageTargets,
	languageKey,
	preferredTrackIndex,
} from "./audio-language.ts";

describe("languageKey", () => {
	it("folds every spelling of a language onto one key", () => {
		for (const code of ["fr", "FR", "fra", "fre", "fr-CA", "fr_FR"]) {
			expect(languageKey(code)).toBe("fr");
		}
		expect(languageKey("ita")).toBe("it");
		expect(languageKey("ger")).toBe("de");
		expect(languageKey("chi")).toBe("zh");
	});

	it("is null for nothing, `und` and garbage", () => {
		expect(languageKey("")).toBeNull();
		expect(languageKey(null)).toBeNull();
		expect(languageKey("und")).toBeNull();
		expect(languageKey("!!")).toBeNull();
	});
});

describe("audioLanguageTargets", () => {
	it("puts the preference first, then the secondary", () => {
		expect(audioLanguageTargets("fre", "eng", ["de-DE"])).toEqual(["fr", "en"]);
	});

	it("uses the browser's languages for `device`", () => {
		expect(
			audioLanguageTargets("device", "it", ["fr-FR", "en-US", "fr"]),
		).toEqual(["fr", "en", "it"]);
	});

	it("leaves the file's default alone for default, original and empty", () => {
		expect(audioLanguageTargets("default", null, ["fr"])).toEqual([]);
		expect(audioLanguageTargets("original", "en", ["fr"])).toEqual(["en"]);
		expect(audioLanguageTargets("", undefined, ["fr"])).toEqual([]);
		expect(audioLanguageTargets("fr", "device", ["en"])).toEqual(["fr"]);
	});
});

describe("preferredTrackIndex", () => {
	const tracks = [{ language: "ita" }, { language: "eng" }, { language: "" }];

	it("finds the track in the best-ranked language", () => {
		expect(preferredTrackIndex(tracks, ["en"])).toBe(1);
		expect(preferredTrackIndex(tracks, ["fr", "it"])).toBe(0);
	});

	it("is -1 when nothing matches or nothing is wanted", () => {
		expect(preferredTrackIndex(tracks, ["fr"])).toBe(-1);
		expect(preferredTrackIndex(tracks, [])).toBe(-1);
	});
});

describe("audioChoiceLabel", () => {
	it("prefixes the spelled-out language onto a release label", () => {
		expect(audioChoiceLabel({ label: "5.1 Atmos", language: "hin" })).toBe(
			"Hindi · 5.1 Atmos",
		);
		expect(audioChoiceLabel({ label: "Piste 2", language: "eng" }, "fr")).toBe(
			"anglais · Piste 2",
		);
	});

	it("keeps a label that already names the language", () => {
		expect(audioChoiceLabel({ label: "English (AC3)", language: "en" })).toBe(
			"English (AC3)",
		);
	});

	it("falls back to the language, then the raw label", () => {
		expect(audioChoiceLabel({ label: "", language: "ta" })).toBe("Tamil");
		expect(audioChoiceLabel({ label: "Track 1", language: "und" })).toBe(
			"Track 1",
		);
		expect(audioChoiceLabel({ label: "Track 1" })).toBe("Track 1");
	});
});
