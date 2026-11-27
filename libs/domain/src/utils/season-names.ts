import { normalizeLanguage } from "./track-selection";

/**
 * "Season 2", "Temporada 02", "Saison 3"...: the name TMDB gives a season when it has none in the
 * requested language (and the one the scanner writes for seasons without metadata).
 */
const GENERIC_SEASON_NAME =
    /^(?:season|temporada|saison|staffel|stagione|seizoen|sezon|säsong|sesong|sæson|kausi)\s*0*(\d+)$/i;
const GENERIC_SPECIALS_NAME = /^(?:specials?|especiales|especiais|extras|spéciaux|épisodes spéciaux|speciali|speciale)$/i;

export type GenericSeasonName = { kind: "season"; number: number } | { kind: "specials" } | null;

/** What a generic season name stands for, or null for a real name (an arc, a subtitle...). */
export const parseGenericSeasonName = (name: string | null | undefined, seasonNumber?: number): GenericSeasonName => {
    const text = (name ?? "").trim();

    const generic = GENERIC_SEASON_NAME.exec(text);
    if (generic) return { kind: "season", number: Number(generic[1]) };
    if (GENERIC_SPECIALS_NAME.test(text)) return { kind: "specials" };

    if (text === "" && seasonNumber !== undefined) {
        return seasonNumber === 0 ? { kind: "specials" } : { kind: "season", number: seasonNumber };
    }
    return null;
};

const SEASON_WORDS: Record<string, { season: string; specials: string }> = {
    en: { season: "Season", specials: "Specials" },
    es: { season: "Temporada", specials: "Especiales" },
    fr: { season: "Saison", specials: "Épisodes spéciaux" },
    de: { season: "Staffel", specials: "Specials" },
    it: { season: "Stagione", specials: "Speciali" },
    pt: { season: "Temporada", specials: "Especiais" },
};

/**
 * The name of a season in `language` ("es-ES", "en"...): generic names are rewritten, real names
 * are kept. Languages without words of their own get the English ones; without a language the
 * name is left as it is.
 */
export const localizeSeasonName = (
    name: string | null | undefined,
    seasonNumber: number | undefined,
    language: string | null | undefined,
): string => {
    const generic = language ? parseGenericSeasonName(name, seasonNumber) : null;
    if (!generic) return (name ?? "").trim();

    const words = SEASON_WORDS[normalizeLanguage(language)] ?? SEASON_WORDS.en;
    return generic.kind === "specials" ? words.specials : `${words.season} ${generic.number}`;
};
