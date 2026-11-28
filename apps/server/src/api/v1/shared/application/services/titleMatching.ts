/** Helpers to choose which result of TMDB fits with the files of a movie or a series */

const BY_TMDB_ORDER = 5;
const BY_TITLE = 7;

export const normalizeTitle = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const bigrams = (text: string): string[] =>
  Array.from({ length: Math.max(text.length - 1, 0) }, (_, i) => text.slice(i, i + 2));

/** 1 for the same title; for the rest, how much they look alike (never above 0.8) */
export const titleSimilarity = (a: string, b: string): number => {
  const first = normalizeTitle(a).replace(/ /g, '');
  const second = normalizeTitle(b).replace(/ /g, '');
  if (!first || !second) return 0;
  if (first === second) return 1;

  const pending = bigrams(second);
  const total = pending.length + first.length - 1;
  let shared = 0;
  for (const pair of bigrams(first)) {
    const index = pending.indexOf(pair);
    if (index >= 0) {
      shared++;
      pending.splice(index, 1);
    }
  }
  return total > 0 ? ((2 * shared) / total) * 0.8 : 0;
};

export const bestTitleSimilarity = (names: string[], titles: (string | undefined)[]): number =>
  Math.max(
    0,
    ...names.flatMap((name, position) =>
      // The folder is more reliable than the name of the file
      titles.map((title) => titleSimilarity(name, title ?? '') * (position === 0 ? 1 : 0.95)),
    ),
  );

/** 1 up to a 5% of difference (other editions, 25 fps copies), 0 from a 25% */
export const runtimeScore = (fileRuntime?: number, tmdbRuntime?: number): number => {
  if (!fileRuntime || !tmdbRuntime) return 0.4;
  const difference = Math.abs(fileRuntime - tmdbRuntime) / Math.max(fileRuntime, tmdbRuntime);
  return Math.min(1, Math.max(0, (0.25 - difference) / 0.2));
};

export const yearScore = (year?: string, releaseDate?: string): number => {
  if (!year || !releaseDate) return 0;
  const difference = Math.abs(Number(year) - Number(releaseDate.slice(0, 4)));
  if (difference === 0) return 1;
  return difference === 1 ? 0.7 : 0;
};

/** Only to break ties: the title more people know is the more likely one */
export const popularityScore = (voteCount?: number): number =>
  Math.min(10, Math.log10((voteCount ?? 0) + 1) * 2.5);

/** The results worth asking the details of: the first of TMDB and the closest by title */
export const selectCandidates = <T extends { id?: number }>(
  names: string[],
  results: T[][],
  titlesOf: (result: T) => (string | undefined)[],
): number[] => {
  const similarity = (result: T) => bestTitleSimilarity(names, titlesOf(result));
  const selected = [
    ...results.flatMap((list) => list.slice(0, BY_TMDB_ORDER)),
    ...results
      .flat()
      .sort((a, b) => similarity(b) - similarity(a))
      .slice(0, BY_TITLE),
  ];

  return [...new Set(selected.map((result) => result.id).filter((id): id is number => !!id))];
};
