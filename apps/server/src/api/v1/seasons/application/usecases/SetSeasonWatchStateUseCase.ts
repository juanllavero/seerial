import type { SeriesRepositoryPort } from '@/api/v1/series/application/ports/SeriesRepositoryPort';
import { NotFoundException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import type { VideoRepositoryPort } from '@/api/v1/videos/application/ports/VideosRepositoryPort';
import type { WatchListRepositoryPort } from '@/api/v1/watch-lists/application/ports/WatchListRepositoryPort';
import { messages } from '@/config/messages';
import type { SeasonsRepositoryPort } from '../ports/SeasonsRepositoryPort';

interface SeasonWithVideos {
  id: string;
  seasonNumber: number;
  videoIds: string[];
}

/**
 * Marks a season as watched or not watched without touching the other seasons.
 * Watching the last season means the whole series has been watched.
 */
export class SetSeasonWatchStateUseCase {
  constructor(
    private seasonRepo: SeasonsRepositoryPort,
    private seriesRepo: SeriesRepositoryPort,
    private videoRepo: VideoRepositoryPort,
    private watchListRepo: WatchListRepositoryPort,
  ) {}

  async execute(seasonId: string, userId: string, watched: boolean): Promise<void> {
    const season = await this.seasonRepo.findById(seasonId);
    if (!season) throw new NotFoundException(messages.errors.notFound.season);

    const seasons = await this.getSeasons(season.seriesId);
    const index = seasons.findIndex((item) => item.id === seasonId);
    if (index === -1) return;

    if (!watched) {
      await this.markNotWatched(seasons[index], userId);
      await this.watchListRepo.removeSeries(userId, season.seriesId);
      return;
    }

    if (index === seasons.length - 1) {
      await this.markSeriesWatched(season.seriesId, seasons, userId);
      return;
    }

    await this.markSeasonWatched(season.seriesId, seasons[index], seasons[index + 1], userId);
  }

  /** Seasons of the series that have videos, in order. */
  private async getSeasons(seriesId: string): Promise<SeasonWithVideos[]> {
    const series = await this.seriesRepo.findById(seriesId, 'few');
    if (!series?.seasons) throw new NotFoundException(messages.errors.notFound.series);

    const seasons = await Promise.all(
      series.seasons.map(async ({ id }) => {
        const season = await this.seasonRepo.findById(id, 'all');
        if (!season) return null;

        const episodes = [...(season.episodes ?? [])].sort(
          (a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
        );
        const videos = await Promise.all(
          episodes.map((episode) => this.videoRepo.findByEpisodeId(episode.id)),
        );

        return {
          id: season.id,
          seasonNumber: season.seasonNumber,
          videoIds: videos.flatMap((video) => (video ? [video.id] : [])),
        };
      }),
    );

    return seasons
      .filter((season): season is SeasonWithVideos => !!season && season.videoIds.length > 0)
      .sort((a, b) => a.seasonNumber - b.seasonNumber);
  }

  private async addSeasonVideos(season: SeasonWithVideos, userId: string): Promise<void> {
    for (const videoId of season.videoIds) {
      await this.watchListRepo.addVideo(userId, videoId);
    }
    await this.watchListRepo.addSeason(userId, season.id);
  }

  private async markNotWatched(season: SeasonWithVideos, userId: string): Promise<void> {
    for (const videoId of season.videoIds) {
      await this.watchListRepo.removeVideo(userId, videoId);
    }
    await this.watchListRepo.removeSeason(userId, season.id);
  }

  private async markSeriesWatched(
    seriesId: string,
    seasons: SeasonWithVideos[],
    userId: string,
  ): Promise<void> {
    await this.watchListRepo.clearContinueWatching(userId, seriesId);
    for (const season of seasons) {
      await this.addSeasonVideos(season, userId);
    }
    await this.watchListRepo.addSeries(userId, seriesId);
  }

  /**
   * If the user was watching an episode of this season, "continue watching" moves on to the next
   * season. A position in any other season is kept.
   */
  private async markSeasonWatched(
    seriesId: string,
    season: SeasonWithVideos,
    nextSeason: SeasonWithVideos,
    userId: string,
  ): Promise<void> {
    const watchStates = await Promise.all(
      season.videoIds.map((videoId) =>
        this.watchListRepo.findByVideoIdAndUserId(videoId, userId),
      ),
    );
    const wasWatchingThisSeason = watchStates.some(
      (state) => !!state && !state.watched && state.seriesId === seriesId,
    );

    await this.addSeasonVideos(season, userId);

    if (!wasWatchingThisSeason) return;

    await this.watchListRepo.clearContinueWatching(userId, seriesId);
    const nextVideoId = nextSeason.videoIds[0];
    // Adding it to "continue watching" would mark an already watched episode as pending
    if (!(await this.watchListRepo.isVideoWatched(nextVideoId, userId))) {
      await this.watchListRepo.addContinueWatchingVideo(nextVideoId, userId, seriesId);
    }
  }
}
