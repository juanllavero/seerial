import type { AudioTrack, SubtitleTrack } from "../interfaces/media-info";

/**
 * When the subtitles are shown by default:
 * - `alwaysSubs`: always, whatever the audio is.
 * - `autoSubs`: full subtitles only when the audio is not the preferred language, forced ones otherwise.
 * - `manualSubs`: never.
 */
export type SubtitleMode = "alwaysSubs" | "autoSubs" | "manualSubs";

export interface TrackPreferences {
    /** Preferred audio language (ISO 639-1 or 639-2, regions are ignored). */
    preferAudioLan?: string;
    /** Preferred subtitles language. */
    preferSubLan?: string;
    subsMode?: string;
}

/** Index of the "no subtitles" selection. */
export const SUBTITLES_OFF = -1;

type SpanishVariant = "spain" | "latin" | "none";

/** Groups of equivalent codes of a language: the first one is the ISO 639-1 code. */
const LANGUAGE_GROUPS: string[][] = [
    ["es", "spa"],
    ["en", "eng"],
    ["pt", "por"],
    ["fr", "fre", "fra"],
    ["de", "ger", "deu"],
    ["it", "ita"],
    ["ru", "rus"],
    ["ar", "ara"],
    ["ja", "jpn"],
    ["ko", "kor"],
    ["zh", "zho", "chi", "cmn"],
    ["hi", "hin"],
    ["pl", "pol"],
    ["nl", "dut", "nld"],
    ["sv", "swe"],
    ["el", "ell", "gre"],
    ["cs", "ces", "cze"],
    ["ro", "ron", "rum"],
    ["fi", "fin"],
    ["tr", "tur"],
    ["th", "tha"],
    ["id", "ind"],
    ["ms", "msa", "may"],
    ["ca", "cat"],
    ["da", "dan"],
    ["no", "nor", "nob"],
    ["hu", "hun"],
    ["he", "heb"],
    ["uk", "ukr"],
    ["vi", "vie"],
    ["bg", "bul"],
    ["hr", "hrv"],
    ["sk", "slk", "slo"],
    ["sr", "srp"],
    ["fa", "fas", "per"],
    ["eu", "eus", "baq"],
    ["gl", "glg"],
    ["is", "isl", "ice"],
    ["et", "est"],
    ["lt", "lit"],
    ["lv", "lav"],
    ["sl", "slv"],
];

/**
 * Names of the languages in themselves. Libraries created by an old version of the web client
 * stored these instead of the language code.
 */
const NATIVE_NAMES: Record<string, string> = {
    es: "español",
    en: "english",
    pt: "português",
    fr: "français",
    de: "deutsch",
    it: "italiano",
    ru: "русский",
    ar: "العربية",
    ja: "日本語",
    ko: "한국어",
    zh: "中文",
    hi: "हिन्दी",
    pl: "polski",
    nl: "nederlands",
    sv: "svenska",
    el: "ελληνικά",
    cs: "čeština",
    ro: "română",
    fi: "suomi",
    tr: "türkçe",
    th: "ไทย",
    id: "bahasa indonesia",
    ms: "bahasa melayu",
    ca: "català",
    da: "dansk",
    no: "norsk",
    hu: "magyar",
    he: "עברית",
    uk: "українська",
    vi: "tiếng việt",
    bg: "български",
    hr: "hrvatski",
    sk: "slovenčina",
    sr: "српски",
    fa: "فارسی",
    eu: "euskara",
    gl: "galego",
    is: "íslenska",
    et: "eesti",
    lt: "lietuvių",
    lv: "latviešu",
    sl: "slovenščina",
};

const LANGUAGE_BY_CODE: ReadonlyMap<string, string> = new Map([
    ...LANGUAGE_GROUPS.flatMap(([iso1, ...others]) => [iso1, ...others].map((code) => [code, iso1] as const)),
    ...Object.entries(NATIVE_NAMES).map(([iso1, name]) => [name, iso1] as const),
]);

/**
 * Normalizes any language code ("es", "es-ES", "spa", "fre", "fra"...) or native name ("Español")
 * to its ISO 639-1 code so that the codes of the settings (two letters) and the ones of the files
 * (three letters) can be compared. Unknown codes are returned in lower case.
 */
export const normalizeLanguage = (code: string | undefined | null): string => {
    const text = (code ?? "").trim().toLowerCase();
    const known = LANGUAGE_BY_CODE.get(text);
    if (known) return known;

    const base = text.split(/[-_]/)[0];
    return LANGUAGE_BY_CODE.get(base) ?? base;
};

/** Labels of the subtitle modes saved by old versions of the web client instead of their keys. */
const LEGACY_SUBTITLE_MODES: Record<string, SubtitleMode> = {
    always: "alwaysSubs",
    "always show": "alwaysSubs",
    "mostrar siempre": "alwaysSubs",
    auto: "autoSubs",
    "with foreign audio": "autoSubs",
    "con audio extranjero": "autoSubs",
    manual: "manualSubs",
    never: "manualSubs",
    nunca: "manualSubs",
};

/** The key of a subtitle mode (also for the labels old versions stored). Unknown values are "auto". */
export const normalizeSubtitleMode = (mode: string | undefined | null): SubtitleMode => {
    const text = (mode ?? "").trim();
    if (text === "alwaysSubs" || text === "autoSubs" || text === "manualSubs") return text;
    return LEGACY_SUBTITLE_MODES[text.toLowerCase()] ?? "autoSubs";
};

const UNDETERMINED_LANGUAGES = new Set(["", "und", "mul", "zxx", "mis"]);

type LanguageTagged = { languageTag?: string; language?: string };

const trackLanguage = (track: LanguageTagged): string => normalizeLanguage(track.languageTag || track.language);

const FORCED_PATTERN = /forced|forzad|forc[ée]/i;

/** Whether the subtitle track only translates the foreign parts of the audio (it is "forced"). */
export const isForcedSubtitleTrack = (track: Pick<SubtitleTrack, "title" | "displayTitle"> & { forced?: boolean }): boolean =>
    track.forced === true || FORCED_PATTERN.test(`${track.title ?? ""} ${track.displayTitle ?? ""}`);

const isLatinSpanish = (track: { languageTag?: string; title?: string }): boolean =>
    normalizeLanguage(track.languageTag) === "es" && /latin|lat|latam|lat_am|latino|latinoam[eé]rica/i.test(track.title ?? "");

/** The variant of Spanish preferred when the interface is in Spanish ("es-ES" → Spain, "es-MX" → Latin America). */
export const getSpanishVariantPreference = (appLanguage?: string): SpanishVariant => {
    if (appLanguage === "es-ES") return "spain";
    // A plain "es" does not say which Spanish: keep the order of the file
    if (/^es-/i.test(appLanguage ?? "")) return "latin";
    return "none";
};

/** The first audio track in the preferred language, or the first one when there is none. */
export const findPreferredAudioIndex = (audioTracks: AudioTrack[] | undefined, preferAudioLan?: string): number => {
    if (!audioTracks || audioTracks.length === 0) return -1;

    const wanted = normalizeLanguage(preferAudioLan);
    if (wanted !== "") {
        const index = audioTracks.findIndex((track) => trackLanguage(track) === wanted);
        if (index !== -1) return index;
    }

    return 0;
};

/**
 * Whether the audio is in a language other than the preferred one. When there is no preferred
 * language or the language of the track is not known nothing can be said, so it is not foreign.
 */
export const isForeignAudio = (audioTrack: AudioTrack | null | undefined, preferAudioLan?: string): boolean => {
    const wanted = normalizeLanguage(preferAudioLan);
    if (!audioTrack || wanted === "") return false;

    const actual = trackLanguage(audioTrack);
    if (UNDETERMINED_LANGUAGES.has(actual)) return false;
    return actual !== wanted;
};

const findSubtitleIndex = (
    tracks: SubtitleTrack[],
    wantedLanguage: string,
    forced: boolean,
    spanishVariant: SpanishVariant,
): number => {
    const candidates: number[] = [];
    tracks.forEach((track, index) => {
        if (trackLanguage(track) === wantedLanguage && isForcedSubtitleTrack(track) === forced) {
            candidates.push(index);
        }
    });
    if (candidates.length === 0) return -1;

    if (wantedLanguage === "es" && spanishVariant !== "none") {
        const wantsLatin = spanishVariant === "latin";
        const variant = candidates.findLast((index) => isLatinSpanish(tracks[index]) === wantsLatin);
        if (variant !== undefined) return variant;
    }

    return candidates[0];
};

/** The first track of any language that is forced (or not), -1 when there is none. */
const findFirstSubtitleIndex = (tracks: SubtitleTrack[], forced: boolean): number =>
    tracks.findIndex((track) => isForcedSubtitleTrack(track) === forced);

/**
 * Chooses the subtitles for an audio track following the subtitle mode:
 * - always: a full track in the preferred language, a forced one in it when there is no other;
 *   without any in that language, the first full track of the file, or else its first forced one.
 * - auto: with foreign audio a full track in the preferred language, or else the first full track
 *   of the file; without foreign audio (or when there are no full tracks) a forced track in the
 *   preferred language; none otherwise.
 * - manual: none.
 *
 * @returns The index of the track or {@link SUBTITLES_OFF}.
 */
export const findPreferredSubtitleIndex = (
    subtitleTracks: SubtitleTrack[] | undefined,
    audioTrack: AudioTrack | null | undefined,
    preferences: TrackPreferences,
    appLanguage?: string,
): number => {
    if (!subtitleTracks || subtitleTracks.length === 0) return SUBTITLES_OFF;

    const mode = normalizeSubtitleMode(preferences.subsMode);
    if (mode === "manualSubs") return SUBTITLES_OFF;

    const wanted = normalizeLanguage(preferences.preferSubLan);
    const variant = getSpanishVariantPreference(appLanguage);
    // Without a preferred language there is nothing "in the preferred language" to find
    const full = () => (wanted === "" ? -1 : findSubtitleIndex(subtitleTracks, wanted, false, variant));
    const forced = () => (wanted === "" ? -1 : findSubtitleIndex(subtitleTracks, wanted, true, variant));
    const firstOf = (...candidates: (() => number)[]) => {
        for (const candidate of candidates) {
            const index = candidate();
            if (index !== -1) return index;
        }
        return SUBTITLES_OFF;
    };
    const anyFull = () => findFirstSubtitleIndex(subtitleTracks, false);
    const anyForced = () => findFirstSubtitleIndex(subtitleTracks, true);

    if (mode === "alwaysSubs") {
        return firstOf(full, forced, anyFull, anyForced);
    }

    if (isForeignAudio(audioTrack, preferences.preferAudioLan)) {
        return firstOf(full, anyFull, forced);
    }
    return firstOf(forced);
};

export interface DefaultTrackSelection {
    /** Index in `audioTracks`, -1 when the video has no audio tracks. */
    audioIndex: number;
    /** Index in `subtitleTracks`, {@link SUBTITLES_OFF} for none. */
    subtitleIndex: number;
}

/**
 * Tracks selected by default for a video with the preferences of its library (or its series).
 * Passing `audioIndex` keeps that audio (the user picked it) and only chooses the subtitles for it.
 */
export const resolveDefaultTracks = (
    video: { audioTracks?: AudioTrack[]; subtitleTracks?: SubtitleTrack[] },
    preferences: TrackPreferences,
    options: { appLanguage?: string; audioIndex?: number } = {},
): DefaultTrackSelection => {
    const audioTracks = video.audioTracks ?? [];
    const audioIndex =
        options.audioIndex !== undefined && options.audioIndex >= 0 && options.audioIndex < audioTracks.length
            ? options.audioIndex
            : findPreferredAudioIndex(audioTracks, preferences.preferAudioLan);

    const subtitleIndex = findPreferredSubtitleIndex(
        video.subtitleTracks,
        audioIndex >= 0 ? audioTracks[audioIndex] : null,
        preferences,
        options.appLanguage,
    );

    return { audioIndex, subtitleIndex };
};

type MatchableTrack = LanguageTagged & {
    codec?: string;
    title?: string;
    displayTitle?: string;
    forced?: boolean;
};

const trackSignature = (track: MatchableTrack): string =>
    [trackLanguage(track), track.codec ?? "", track.title ?? "", track.displayTitle ?? ""].join("|");

const isSameKind = (a: MatchableTrack, b: MatchableTrack): boolean =>
    isForcedSubtitleTrack({ title: a.title ?? "", displayTitle: a.displayTitle ?? "", forced: a.forced }) ===
    isForcedSubtitleTrack({ title: b.title ?? "", displayTitle: b.displayTitle ?? "", forced: b.forced });

/**
 * Finds in `target` the track that is the same as `source[sourceIndex]`: same language (and forced
 * or not) and, when several fit, the same position among them ("the second Spanish track").
 * Tracks with the same codec and title are preferred over the ones that merely share the language.
 *
 * @returns The index in `target`, or -1 when the other video has no such track.
 */
export const findMatchingTrackIndex = (
    source: MatchableTrack[],
    sourceIndex: number,
    target: MatchableTrack[],
): number => {
    const reference = source[sourceIndex];
    if (!reference || target.length === 0) return -1;

    const language = trackLanguage(reference);
    const sameKind = (track: MatchableTrack) => trackLanguage(track) === language && isSameKind(track, reference);

    const sourceCandidates = source.map((_, index) => index).filter((index) => sameKind(source[index]));
    const targetCandidates = target.map((_, index) => index).filter((index) => sameKind(target[index]));
    if (targetCandidates.length === 0) return -1;

    const signature = trackSignature(reference);
    const exactSource = sourceCandidates.filter((index) => trackSignature(source[index]) === signature);
    const exactTarget = targetCandidates.filter((index) => trackSignature(target[index]) === signature);
    if (exactTarget.length > 0) {
        return exactTarget[Math.min(exactSource.indexOf(sourceIndex), exactTarget.length - 1)];
    }

    return targetCandidates[sourceCandidates.indexOf(sourceIndex)] ?? -1;
};
