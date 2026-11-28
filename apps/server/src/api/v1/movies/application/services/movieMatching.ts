import type { MovieResponse, MovieResult } from 'moviedb-promise';
import type { MetadataProviderPort } from '@/api/v1/shared/application/ports/MetadataProviderPort';
import {
  bestTitleSimilarity,
  popularityScore,
  runtimeScore,
  selectCandidates,
  yearScore,
} from '@/api/v1/shared/application/services/titleMatching';

/** What is known about a movie from its files */
export interface MovieQuery {
  /** Name of the folder first, then the name of the file */
  names: string[];
  year?: string;
  /** Duration of the file, in minutes */
  runtime?: number;
}

/** Details of TMDB with the titles of the movie in other languages */
export type MovieDetails = MovieResponse & {
  alternative_titles?: { titles?: { title?: string }[] };
  translations?: { translations?: { data?: { title?: string } }[] };
};

export const scoreMovie = (query: MovieQuery, movie: MovieDetails): number => {
  const titles = [
    movie.title,
    movie.original_title,
    ...(movie.alternative_titles?.titles?.map((t) => t.title) ?? []),
    ...(movie.translations?.translations?.map((t) => t.data?.title) ?? []),
  ];
  return (
    bestTitleSimilarity(query.names, titles) * 60 +
    runtimeScore(query.runtime, movie.runtime) * 30 +
    yearScore(query.year, movie.release_date) * 20 +
    popularityScore(movie.vote_count)
  );
};

/**
 * The movie of TMDB that fits better with the files. The first result of a search is only the most
 * popular one: a documentary about a movie, a remake or another movie with a similar title.
 */
export async function findMovie(
  provider: MetadataProviderPort,
  query: MovieQuery,
  language: string,
): Promise<MovieDetails | null> {
  const searches: Promise<MovieResult[]>[] = [];
  for (const name of query.names) {
    searches.push(provider.searchMovies(name, '', language));
    // A common title can leave the movie of that year out of the first page
    if (query.year) searches.push(provider.searchMovies(name, query.year, language));
  }
  const ids = selectCandidates(query.names, await Promise.all(searches), (movie) => [
    movie.title,
    movie.original_title,
  ]);

  const candidates: (MovieDetails | null)[] = await Promise.all(
    ids.map((id) => provider.getMovie(id, language, ['alternative_titles', 'translations'])),
  );

  let best: MovieDetails | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const score = scoreMovie(query, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
