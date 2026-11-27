import { useGetEpisode, useGetSeason, useGetSeries } from '@seerial/api';
import type { Episode, Season, Series, Video } from '@seerial/domain';
import { useMemo } from 'react';

const SPECIALS_SEASON_NUMBER = 0;

const byEpisodeNumber = (a: Episode, b: Episode) => a.episodeNumber - b.episodeNumber;

/**
 * The episode that follows `episodeId`: the next one of its season, or the first one of the next
 * season. Specials are never reached from a regular season, and the specials season never jumps
 * to a regular one.
 */
export function findNextEpisode(series: Series | undefined, episodeId: string): Episode | null {
  const seasons = series?.seasons?.toSorted((a, b) => a.seasonNumber - b.seasonNumber) ?? [];
  const seasonIndex = seasons.findIndex((season) =>
    season.episodes.some((episode) => episode.id === episodeId),
  );
  if (seasonIndex === -1) return null;

  const playable = (season: Season) =>
    season.episodes.filter((episode) => !!episode.video?.id).toSorted(byEpisodeNumber);

  const currentSeason = seasons[seasonIndex];
  const currentEpisodes = playable(currentSeason);
  const episodeIndex = currentEpisodes.findIndex((episode) => episode.id === episodeId);
  const nextInSeason = episodeIndex === -1 ? undefined : currentEpisodes[episodeIndex + 1];
  if (nextInSeason) return nextInSeason;

  if (currentSeason.seasonNumber === SPECIALS_SEASON_NUMBER) return null;

  for (const season of seasons.slice(seasonIndex + 1)) {
    if (season.seasonNumber === SPECIALS_SEASON_NUMBER) continue;
    const first = playable(season)[0];
    if (first) return first;
  }

  return null;
}

export interface NextEpisodeInfo {
  seriesId: string;
  episode: Episode;
}

/** Resolves the episode to play after `video` (null for movies, extras or the last episode). */
export function useNextEpisode(video: Video | undefined): NextEpisodeInfo | null {
  const episodeId = video?.episodeId ?? '';

  const { data: episode } = useGetEpisode<Episode>(episodeId, { enabled: !!episodeId });
  const seasonId = episode?.seasonId ?? '';
  const { data: season } = useGetSeason<Season>(seasonId, 'none', { enabled: !!seasonId });
  const seriesId = season?.seriesId ?? '';
  // Same query as the details page, so it usually comes from the cache
  const { data: series } = useGetSeries<Series>(seriesId, {
    enabled: !!seriesId,
    params: { include: 'all' },
  });

  return useMemo(() => {
    if (!episodeId || !series) return null;
    const next = findNextEpisode(series, episodeId);
    return next ? { seriesId: series.id, episode: next } : null;
  }, [episodeId, series]);
}
