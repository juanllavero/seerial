import type { ShowResponse, TvResult } from 'moviedb-promise';
import type { MetadataProviderPort } from '@/api/v1/shared/application/ports/MetadataProviderPort';
import {
  bestTitleSimilarity,
  popularityScore,
  runtimeScore,
  selectCandidates,
  yearScore,
} from '@/api/v1/shared/application/services/titleMatching';

/** Number of an episode as written in the name of its file */
export interface FileEpisode {
  /** Undefined when the file only has an absolute number */
  season?: number;
  episode: number;
}

/** What is known about a series from its files */
export interface SeriesQuery {
  /** Name of the folder first, then the name written in the files */
  names: string[];
  year?: string;
  /** Duration of one of the episodes, in minutes */
  runtime?: number;
  episodes: FileEpisode[];
}

/** Details of TMDB with the names of the series in other languages */
export type SeriesDetails = ShowResponse & {
  alternative_titles?: { results?: { title?: string }[] };
  translations?: { translations?: { data?: { name?: string } }[] };
  vote_count?: number;
  /** TMDB sends it, the types of the library do not declare it */
  last_episode_to_air?: { runtime?: number };
};

/**
 * Part of the episodes of the files that the series has. A live action with a few episodes per
 * season cannot have the files of a long anime with the same name.
 */
const episodesScore = (episodes: FileEpisode[], show: SeriesDetails): number => {
  // Specials are listed very differently from one source to another
  const regular = episodes.filter((episode) => episode.season !== 0);
  const counts = new Map(
    (show.seasons ?? [])
      .filter((season) => (season.season_number ?? 0) > 0)
      .map((season) => [season.season_number as number, season.episode_count ?? 0]),
  );
  if (regular.length === 0 || counts.size === 0) return 0.4;

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const found = regular.filter(({ season, episode }) =>
    season === undefined ? episode <= total : episode <= (counts.get(season) ?? 0),
  );
  return found.length / regular.length;
};

/**
 * A continuation is usually known by the name of the original plus a subtitle ("Name: Subtitle"),
 * and the folder often has only the name
 */
const titleScore = (names: string[], titles: (string | undefined)[]): number =>
  Math.max(
    bestTitleSimilarity(names, titles),
    bestTitleSimilarity(
      names,
      titles.map((title) => title?.split(/: | - /)[0]),
    ) * 0.9,
  );

export const scoreSeries = (query: SeriesQuery, show: SeriesDetails): number => {
  const titles = [
    show.name,
    show.original_name,
    ...(show.alternative_titles?.results?.map((t) => t.title) ?? []),
    ...(show.translations?.translations?.map((t) => t.data?.name) ?? []),
  ];
  const runtime = show.last_episode_to_air?.runtime || show.episode_run_time?.[0];

  return (
    titleScore(query.names, titles) * 60 +
    episodesScore(query.episodes, show) * 30 +
    yearScore(query.year, show.first_air_date) * 20 +
    runtimeScore(query.runtime, runtime) * 20 +
    popularityScore(show.vote_count)
  );
};

/** The series of TMDB that fits better with the files, not just the first result of a search */
export async function findSeries(
  provider: MetadataProviderPort,
  query: SeriesQuery,
  language: string,
): Promise<SeriesDetails | null> {
  const searches: Promise<TvResult[]>[] = [];
  for (const name of query.names) {
    searches.push(provider.searchTVShows(name, '', language));
    // A common name can leave the series of that year out of the first page
    if (query.year) searches.push(provider.searchTVShows(name, query.year, language));
  }
  const ids = selectCandidates(query.names, await Promise.all(searches), (show) => [
    show.name,
    show.original_name,
  ]);

  const candidates: (SeriesDetails | null)[] = await Promise.all(
    ids.map((id) => provider.getTVShow(id, language, ['alternative_titles', 'translations'])),
  );

  let best: SeriesDetails | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const score = scoreSeries(query, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
