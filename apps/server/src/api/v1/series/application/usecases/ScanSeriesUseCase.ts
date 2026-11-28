import { simplifyOnlySeasonBackground } from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import { localizeSeasonName } from '@seerial/domain';
import path from 'node:path';
import type { Video } from '@seerial/domain';
import type {
  Episode,
  EpisodeGroupResponse,
  Episode as MovieDBEpisode,
  TvSeasonResponse,
} from 'moviedb-promise';
import type { EpisodeRepositoryPort } from '@/api/v1/episodes/application/ports/EpisodeRepositoryPort';
import type { LibrariesRepositoryPort } from '@/api/v1/libraries/application/ports/LibrariesRepositoryPort';
import type { Library } from '@/api/v1/libraries/domain/Library';
import type { SeasonsRepositoryPort } from '@/api/v1/seasons/application/ports/SeasonsRepositoryPort';
import type { Season } from '@/api/v1/seasons/domain/Season';
import type { FileSystemServicePort } from '@/api/v1/shared/application/ports/FileSystemServicePort';
import type { MetadataProviderPort } from '@/api/v1/shared/application/ports/MetadataProviderPort';
import { getMediaInfo, getOnlyRuntime } from '@/api/v1/shared/infrastructure/adapters/ffmpeg/mediaInfo';
import type { NotificationServicePort } from '@/api/v1/shared/application/ports/NotificationServicePort';
import {
  downloaderService,
  videoExtractionService,
} from '@/api/v1/shared/infrastructure/adapters/di/container';
import { WriteQueue } from '@/api/v1/shared/infrastructure/services/WriteQueue';
import type { VideoRepositoryPort } from '@/api/v1/videos/application/ports/VideosRepositoryPort';
import logger from '@/utils/logger';
import type { Episode as EpisodeLocal } from '../../../episodes/domain/Episode';
import type { Series } from '../../domain/Series';
import type { SeriesRepositoryPort } from '../ports/SeriesRepositoryPort';
import { findSeries, type SeriesQuery } from '../services/seriesMatching';
import { matchSpecialEpisode } from '../utils/matchSpecialEpisode';

/** Season and episode written in the file name: S02E00 */
const EXPLICIT_SEASON_EPISODE = /s\d{1,4}(?:[.]|[\s-]+)?ep?\d{1,4}/i;

/** Point of the video where the thumbnail of an episode without images is taken */
const THUMBNAIL_POSITION = 0.25;

/** Folders inside a series whose videos are not episodes */
const EXTRAS_FOLDER = /^(extras?|featurettes|trailers|behind the scenes|deleted scenes|interviews|shorts)$/i;

interface EpisodeResolution {
  videoSrc: string;
  seasonMetadata: TvSeasonResponse | null;
  episodeMetadata: Episode | null;
  realSeason?: number;
  realEpisode?: number;
  /** Where the metadata come from when it is not the episode with the numbers of the file */
  metadataSource?: 'special' | 'none';
}

interface EpisodeBatchUpdate {
  episode: EpisodeLocal;
  video: Video;
  metadata: Episode;
}

export class ScanSeriesUseCase {
  private readonly writeQueue = new WriteQueue();

  constructor(
    private readonly filesManager: FileSystemServicePort,
    private readonly librariesRepo: LibrariesRepositoryPort,
    private readonly seriesRepo: SeriesRepositoryPort,
    private readonly seasonsRepo: SeasonsRepositoryPort,
    private readonly videoRepo: VideoRepositoryPort,
    private readonly episodesRepo: EpisodeRepositoryPort,
    private readonly metadataProvider: MetadataProviderPort,
    private readonly notificationService: NotificationServicePort,
  ) { }

  async execute(library: Library, root: string): Promise<void> {
    logger.info(
      {
        libraryId: library.id,
        root,
      },
      'Starting series scan execution',
    );

    if (!(await this.filesManager.isFolder(root))) {
      logger.warn(
        {
          libraryId: library.id,
          root,
        },
        'Root path is not a valid folder, skipping scan',
      );
      return;
    }

    // Check for valid video files inside folder
    const videoFiles = await this.filesManager.getValidVideoFiles(root);
    if (videoFiles.length === 0) {
      logger.warn(
        {
          libraryId: library.id,
          root,
        },
        'No valid video files found in folder, skipping scan',
      );
      return;
    }

    // Smart skip: check if any files changed
    if (!(await this.hasFilesChanged(library, videoFiles))) {
      logger.info(
        {
          libraryId: library.id,
          root,
          fileCount: videoFiles.length,
        },
        'All files already analyzed, skipping scan',
      );
      return;
    }

    // Get or create series (wrapped in queue)
    const show = await this.writeQueue.enqueue(async () => {
      return await this.getOrCreateSeries(library, root);
    });

    if (!show) {
      logger.error(
        {
          libraryId: library.id,
          root,
        },
        'Failed to get or create series',
      );
      return;
    }

    // Search and update metadata
    const hasValidMetadata = await this.ensureSeriesMetadata(library, show, root, videoFiles);
    if (!hasValidMetadata) {
      await this.cleanupInvalidSeries(library, show, root);
      return;
    }

    // Download main theme in parallel
    downloaderService.autoDownloadFirstAudioResult(`${show.name} main theme`, 'series', show, {
      id: library.id,
      name: library.name,
    });

    // Update series analyzing status
    await this.writeQueue.enqueue(async () => {
      show.analyzingFiles = true;
      await this.seriesRepo.update(show.id, show);
    });

    this.notificationService.mutateSeries(show);

    // Broadcast scan started
    this.notificationService.broadcast(
      JSON.stringify({
        header: 'SERIES_SCAN_PROGRESS',
        body: {
          seriesId: show.id,
          status: 'started',
          processed: 0,
          total: videoFiles.length,
        },
      }),
    );

    // Download seasons metadata
    const showData = await this.metadataProvider.getTVShow(show.themdbId, library.language);

    if (!showData?.seasons) {
      logger.error(
        {
          seriesId: show.id,
          tmdbId: show.themdbId,
          showData: showData,
        },
        'TV show data has no seasons, cannot proceed',
      );
      return;
    }

    const showDataId = showData.id;
    if (!showDataId) {
      logger.error(
        {
          seriesId: show.id,
          tmdbId: show.themdbId,
        },
        'TV show data has no TMDb id, cannot proceed',
      );
      return;
    }

    const seasonPromises = showData.seasons
      .filter((seasonBasic) => seasonBasic.season_number != null)
      .map((seasonBasic) =>
        this.metadataProvider.getSeason(
          showDataId,
          seasonBasic.season_number as number,
          library.language,
        ),
      );

    const seasonsMetadata = (await Promise.all(seasonPromises)).filter(
      Boolean,
    ) as TvSeasonResponse[];

    if (seasonsMetadata.length === 0) {
      logger.error(
        {
          seriesId: show.id,
          tmdbId: show.themdbId,
          seasonsRequested: showData.seasons.length,
        },
        'No valid season metadata downloaded, cannot proceed',
      );
      return;
    }

    // Download episode groups metadata if needed
    let episodesGroup: EpisodeGroupResponse | undefined;
    if (show.episodeGroupId) {
      try {
        episodesGroup = await this.metadataProvider.getEpisodeGroup(show.episodeGroupId);
      } catch (error) {
        logger.error(
          {
            seriesId: show.id,
            episodeGroupId: show.episodeGroupId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to download episode groups metadata',
        );
      }
    }

    // Process episodes
    await this.processEpisodes(library, videoFiles, show, seasonsMetadata, episodesGroup);

    // Check if series has valid seasons
    const seasons = await this.seasonsRepo.findSeasonsBySeriesId(show.id);
    if (!seasons || seasons.length < 1) {
      logger.error(
        {
          seriesId: show.id,
          seasonsFound: seasons?.length || 0,
        },
        'No valid seasons found after processing, deleting series',
      );
      await this.writeQueue.enqueue(async () => {
        await this.seriesRepo.delete(show.id);
      });
      return;
    }

    await this.writeQueue.enqueue(() => simplifyOnlySeasonBackground(show.id));

    // Update series analyzing status
    await this.writeQueue.enqueue(async () => {
      show.analyzingFiles = false;
      await this.seriesRepo.update(show.id, show);
    });

    this.notificationService.mutateSeries(show);

    // Broadcast scan completed
    this.notificationService.broadcast(
      JSON.stringify({
        header: 'SERIES_SCAN_PROGRESS',
        body: {
          seriesId: show.id,
          status: 'completed',
          processed: videoFiles.length,
          total: videoFiles.length,
        },
      }),
    );
  }

  //#region SERIES MANAGEMENT

  /**
   * Gets existing series or creates a new one
   */
  private async getOrCreateSeries(library: Library, root: string): Promise<Series | null> {
    // Check for library cache
    if (root in library.analyzedFolders) {
      const show = await this.seriesRepo.findById(library.analyzedFolders[root] ?? '');
      if (show) return show;
    }

    // Create new series
    const show = await this.seriesRepo.create({
      folder: root,
      libraryId: library.id,
    });

    if (!show) return null;

    // Update library cache
    library.analyzedFolders = {
      ...library.analyzedFolders,
      [root]: show.id,
    };

    await this.librariesRepo.addAnalyzedFolder(library.id, root, show.id);

    return show;
  }

  /**
   * Ensures series has TMDb ID and metadata
   */
  private async ensureSeriesMetadata(
    library: Library,
    show: Series,
    root: string,
    videoFiles: string[],
  ): Promise<boolean> {
    const parsed = this.extractSeriesNameAndYear(root);

    // Search for themdbId if not set
    if (show.themdbId === -1) {
      logger.info(
        {
          seriesId: show.id,
          extractedName: parsed.name,
          extractedYear: parsed.year,
        },
        'Extracted series name and year from folder path',
      );

      try {
        const found = await findSeries(
          this.metadataProvider,
          await this.buildSeriesQuery(parsed, videoFiles),
          library.language,
        );

        if (!found) {
          logger.warn(
            {
              seriesId: show.id,
              searchName: parsed.name,
              searchYear: parsed.year,
            },
            'No TV shows found in TMDb search, cannot proceed with metadata',
          );
          return false;
        }

        show.themdbId = found.id ?? -1;
      } catch (error) {
        logger.error(
          {
            seriesId: show.id,
            searchName: parsed.name,
            searchYear: parsed.year,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to search for series in TMDb',
        );
        return false;
      }
    }

    if (show.themdbId <= 0) {
      logger.warn(
        {
          seriesId: show.id,
          tmdbId: show.themdbId,
        },
        'Series has no valid TMDb id after search, skipping scan',
      );
      return false;
    }

    // Update series metadata
    try {
      await this.metadataProvider.updateSeriesMetadata(show, library.language);
    } catch (error) {
      logger.error(
        {
          seriesId: show.id,
          tmdbId: show.themdbId,
          language: library.language,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to update series metadata',
      );
    }

    if (!show.name?.trim()) {
      show.name = parsed.name;
      await this.seriesRepo.update(show.id, show);
    }

    return true;
  }

  private extractSeriesNameAndYear(root: string): { name: string; year: string } {
    let name: string = root.split(/[/\\]/).pop() ?? '';
    const pattern = /^(.*?)(?:\s(\d{4}))?$/;
    let year = '';
    const matcher = name.replace(/[()]/g, '').match(pattern);

    if (matcher) {
      name = matcher[1];
      year = matcher[2] ?? '';
    }

    return { name, year };
  }

  /** What the files say about the series, to tell it apart from others with a similar name */
  private async buildSeriesQuery(
    parsed: { name: string; year: string },
    videoFiles: string[],
  ): Promise<SeriesQuery> {
    const files = videoFiles
      .filter((file) => !EXTRAS_FOLDER.test(path.basename(path.dirname(file))))
      .sort();
    const numbered = files.flatMap((file) => {
      const [episode, season] = this.extractEpisodeSeason(path.parse(file).name);
      return Number.isNaN(episode) ? [] : [{ file, season, episode }];
    });

    // The name written before the number of the episode: "[Group] Name - 01", "Name S01E01"
    const fileName = path
      .parse(numbered[0]?.file ?? videoFiles[0])
      .name.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/[._]/g, ' ');
    const nameInFiles = /^(.*?)(?:\bs\d{1,4}\s*ep?\d|\s-\s*\d)/i.exec(fileName)?.[1].replace(/[\s\-–—]+$/, '')
      .trim();
    const names = [parsed.name.trim()];
    if (nameInFiles && nameInFiles.toLowerCase() !== names[0].toLowerCase()) {
      names.push(nameInFiles);
    }

    return {
      names,
      year: parsed.year || undefined,
      // Specials are often longer or shorter than the episodes
      runtime: await this.getEpisodeRuntime(
        numbered.filter(({ season }) => season !== 0).map(({ file }) => file),
      ),
      episodes: numbered.map(({ season, episode }) => ({ season, episode })),
    };
  }

  /** Median of a few episodes: the first one is often longer than the rest */
  private async getEpisodeRuntime(files: string[]): Promise<number | undefined> {
    const samples = new Set([files[0], files[Math.floor(files.length / 2)], files.at(-1)]);
    const runtimes = (
      await Promise.all([...samples].map((file) => (file ? getOnlyRuntime(file) : 0)))
    )
      .filter((runtime) => runtime > 0)
      .sort((a, b) => a - b);

    return runtimes[Math.floor((runtimes.length - 1) / 2)];
  }

  private async cleanupInvalidSeries(library: Library, show: Series, root: string): Promise<void> {
    logger.warn(
      {
        libraryId: library.id,
        seriesId: show.id,
        root,
        tmdbId: show.themdbId,
      },
      'Removing invalid series created during scan',
    );

    await this.writeQueue.enqueue(async () => {
      await this.seriesRepo.delete(show.id);
      await this.librariesRepo.removeAnalyzedFolder(library.id, root);
    });

    if (root in library.analyzedFolders) {
      delete library.analyzedFolders[root];
    }

    this.notificationService.mutateLibrary(library.id);
  }

  /**
   * Checks if any files have changed since last scan
   */
  private async hasFilesChanged(library: Library, videoFiles: string[]): Promise<boolean> {
    // If any file is not in analyzedFiles, we have changes
    const hasNewFiles = videoFiles.some((file) => !(file in library.analyzedFiles));

    if (hasNewFiles) return true;

    // Check if all analyzed files still exist
    const analyzedFilesForThisFolder = Object.keys(library.analyzedFiles);
    const missingFiles = analyzedFilesForThisFolder.filter((file) => !videoFiles.includes(file));

    return missingFiles.length > 0;
  }

  //#endregion

  //#region EPISODE PROCESSING

  /**
   * Processes all video files of a series to add the seasons and episodes
   */
  async processEpisodes(
    library: Library,
    videoFiles: string[],
    show: Series,
    seasonsMetadata: TvSeasonResponse[],
    episodesGroup: EpisodeGroupResponse | undefined,
  ) {
    const seasonsIndex = this.indexSeasons(seasonsMetadata);
    const cumulativeEpisodes = this.buildCumulativeEpisodes(seasonsMetadata);

    // Parallel episode detection
    const resolutionPromises = videoFiles.map((videoFile) =>
      this.resolveEpisodeMetadata(
        show,
        videoFile,
        seasonsMetadata,
        seasonsIndex,
        cumulativeEpisodes,
        episodesGroup,
      ).then((resolution) => ({ videoSrc: videoFile, ...resolution })),
    );

    const resolutions = await Promise.all(resolutionPromises);

    // Serial processing through queue with batch updates
    let processedFiles = 0;
    let skippedFiles = 0;
    const batchUpdates: EpisodeBatchUpdate[] = [];

    for (let resolution of resolutions) {
      const alreadyAnalyzed = library.analyzedFiles[resolution.videoSrc];
      const hasEpisode = alreadyAnalyzed
        ? await this.episodesRepo.findByVideoSrc(resolution.videoSrc)
        : null;

      if (alreadyAnalyzed && hasEpisode) {
        skippedFiles++;
        continue;
      }

      if (!resolution.seasonMetadata || !resolution.episodeMetadata) {
        resolution =
          (await this.resolveUnlistedEpisode(library, resolution, seasonsMetadata)) ?? resolution;
      }

      if (!resolution.seasonMetadata || !resolution.episodeMetadata) {
        logger.warn(
          {
            seriesId: show.id,
            videoSrc: resolution.videoSrc,
            extractedSeason: resolution.realSeason,
            extractedEpisode: resolution.realEpisode,
            hasSeasonMetadata: !!resolution.seasonMetadata,
            hasEpisodeMetadata: !!resolution.episodeMetadata,
          },
          'Could not resolve season/episode metadata for file, skipping',
        );
        continue;
      }

      try {
        await this.writeQueue.enqueue(async () => {
          const result = await this.processEpisode(library, show, resolution);

          if (result) {
            batchUpdates.push(result);
          }
        });
        processedFiles++;

        // Progress reporting
        if (processedFiles % 5 === 0 || processedFiles === resolutions.length) {
          this.notificationService.broadcast(
            JSON.stringify({
              header: 'SERIES_SCAN_PROGRESS',
              body: {
                seriesId: show.id,
                status: 'processing',
                processed: processedFiles + skippedFiles,
                total: videoFiles.length,
              },
            }),
          );
        }
      } catch (error) {
        logger.error(
          {
            seriesId: show.id,
            videoFile: resolution.videoSrc,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to process video file',
        );
      }
    }

    // Batch metadata updates
    if (batchUpdates.length > 0) {
      await this.batchUpdateEpisodeMetadata(show, batchUpdates);
    }

    // Post-processing: rename seasons
    await this.postProcessSeasons(show, episodesGroup, library.language);
  }

  /**
   * Processes a video file to add the season and episode
   * Returns episode data for batch update if successful
   */
  async processEpisode(
    library: Library,
    show: Series,
    resolution: EpisodeResolution,
  ): Promise<EpisodeBatchUpdate | null> {
    const { videoSrc, seasonMetadata, episodeMetadata, realSeason, realEpisode, metadataSource } =
      resolution;

    if (!seasonMetadata || !episodeMetadata) {
      logger.warn(
        {
          seriesId: show.id,
          videoSrc,
          realSeason,
          realEpisode,
        },
        'Could not resolve season/episode metadata for file, skipping',
      );
      return null;
    }

    // Ensure season exists
    const season = await this.ensureSeason(
      show,
      seasonMetadata,
      realSeason,
      realEpisode,
      library.language,
    );
    if (!season) {
      logger.error(
        {
          seriesId: show.id,
          videoSrc,
          seasonNumber: seasonMetadata.season_number,
        },
        'Failed to ensure season exists in database',
      );
      return null;
    }

    // Ensure episode exists
    const episode = await this.ensureEpisode(
      season,
      episodeMetadata,
      realEpisode,
      library,
      videoSrc,
      metadataSource === 'special' ? episodeMetadata : undefined,
    );
    if (!episode) {
      logger.error(
        {
          seriesId: show.id,
          seasonId: season.id,
          videoSrc,
          episodeNumber: episodeMetadata.episode_number,
        },
        'Failed to ensure episode exists in database',
      );
      return null;
    }

    // Ensure video exists
    let video = await this.videoRepo.findByEpisodeId(episode.id);
    if (!video) {
      video = await this.videoRepo.addAsEpisode(episode.id, {
        fileSrc: videoSrc,
      });
      if (!video) {
        logger.error(
          {
            seriesId: show.id,
            episodeId: episode.id,
            videoSrc,
          },
          'Failed to create video entry for episode',
        );
        return null;
      }
    }

    this.notificationService.mutateSeason();

    // Extract media info for new video (tracks, codec, runtime)
    await this.ensureMediaInfo(video, videoSrc);

    // Without metadata there is nothing to download: only the thumbnail, taken from the video
    if (metadataSource === 'none') {
      await this.ensureFrameThumbnail(video, videoSrc);
      return null;
    }
    if (metadataSource === 'special' && !episodeMetadata.still_path) {
      await this.ensureFrameThumbnail(video, videoSrc);
    }

    // Return data for batch update
    return {
      episode,
      video,
      metadata: episodeMetadata,
    };
  }

  /**
   * Batch update episode metadata to reduce API calls
   */
  private async batchUpdateEpisodeMetadata(
    show: Series,
    updates: EpisodeBatchUpdate[],
  ): Promise<void> {
    // Process in chunks to avoid overwhelming the system
    const chunkSize = 10;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);

      const updatePromises = chunk.map(({ episode, video, metadata }) =>
        this.metadataProvider
          .updateEpisodeMetadata(episode, video, show, metadata)
          .catch((error) => {
            logger.error(
              {
                seriesId: show.id,
                episodeId: episode.id,
                videoId: video.id,
                error: error instanceof Error ? error.message : String(error),
              },
              'Failed to update episode metadata in batch',
            );
          }),
      );

      await Promise.all(updatePromises);
    }
  }

  /**
   * Post-processes seasons to rename based on episode groups or fix duplicates
   */
  private async postProcessSeasons(
    show: Series,
    episodesGroup: EpisodeGroupResponse | undefined,
    language?: string,
  ): Promise<void> {
    const seasons = await this.seasonsRepo.findSeasonsBySeriesId(show.id);
    if (!seasons) {
      logger.error(
        {
          seriesId: show.id,
        },
        'Failed to retrieve seasons after processing',
      );
      return;
    }

    // Rename seasons based on episodes group
    if (show.episodeGroupId && episodesGroup?.groups) {
      for (const season of seasons) {
        const group = episodesGroup.groups.find((g) => g.order === season.seasonNumber);
        if (group?.name && season.name !== group.name) {
          season.name = group.name;
          await this.seasonsRepo.update(season.id, season);
        }
      }
    } else if (seasons.length > 1 && seasons[0].name === seasons[1].name) {
      // Apply default season numbering due to duplicate names
      for (const season of seasons) {
        if (season.seasonNumber !== 0) {
          const newName = localizeSeasonName('', season.seasonNumber, language);
          if (season.name !== newName) {
            season.name = newName;
            await this.seasonsRepo.update(season.id, season);
          }
        }
      }
    }
  }

  private async ensureMediaInfo(video: Video, filePath: string): Promise<void> {
    if (video.audioTracks && video.audioTracks.length > 0) return;

    logger.info({ videoId: video.id, filePath }, 'Extracting media info for video');

    try {
      const mediaInfo = await getMediaInfo(filePath, false);
      if (!mediaInfo) {
        logger.warn({ filePath }, 'getMediaInfo returned no data for episode video');
        return;
      }
      video.mediaInfo = mediaInfo.mediaInfo;
      video.videoTracks = mediaInfo.videoTracks;
      video.subtitleTracks = mediaInfo.subtitleTracks;
      video.audioTracks = mediaInfo.audioTracks;
      video.runtime = mediaInfo.duration;
      await this.videoRepo.update(video.id, video);
    } catch (_e) {
      logger.warn({ filePath }, 'Failed to extract media info for episode video');
    }
  }

  private async ensureFrameThumbnail(video: Video, filePath: string): Promise<void> {
    if (video.imgSrc?.startsWith('resources/img/thumbnails/')) return;

    // The runtime of a video is stored in minutes
    const time = Math.floor((video.runtime ?? 0) * 60 * THUMBNAIL_POSITION);
    const thumbnail = await videoExtractionService.generateVideoThumbnail(video.id, filePath, time);
    if (!thumbnail) return;

    video.imgSrc = thumbnail;
    video.imgUrls = [thumbnail];
    await this.videoRepo.update(video.id, video);
  }

  //#endregion

  //#region SEASON & EPISODE DB HELPERS

  /**
   * Ensures a season exists in the database
   */
  async ensureSeason(
    show: Series,
    seasonMetadata: TvSeasonResponse,
    realSeason?: number,
    realEpisode?: number,
    /** Language of the library: generic names ("Season 2") are stored in it */
    language?: string,
  ): Promise<Season | null> {
    // The season written in the file name (S02E05), or the one of the metadata when the file only
    // has an absolute number. The same number must be used to look for the season and to create it,
    // otherwise every episode creates a new season.
    const seasonNumber = realEpisode !== -1 ? (realSeason ?? seasonMetadata.season_number ?? 0) : (seasonMetadata.season_number ?? 0);

    const seasons = await this.seasonsRepo.findSeasonsBySeriesId(show.id);
    let season: Season | null = seasons?.find((s: Season) => s.seasonNumber === seasonNumber) ?? null;

    if (season) return season;

    season = await this.seasonsRepo.create({
      seriesId: show.id,
      name: localizeSeasonName(seasonMetadata.name, seasonNumber, language),
      year: seasonMetadata.episodes?.[0]?.air_date ?? '',
      overview: seasonMetadata.overview ?? show.overview,
      seasonNumber,
    });

    if (!season) return null;

    // Update metadata
    await this.metadataProvider.updateSeasonMetadata(season, show);

    if (season.seasonNumber === 0) season.order = 100;
    await this.seasonsRepo.update(season.id, season);

    this.notificationService.mutateSeries(show);
    return season;
  }

  /**
   * Ensures an episode exists in the database
   */
  async ensureEpisode(
    season: Season,
    episodeMetadata: Episode,
    realEpisode: number | undefined,
    library: Library,
    videoSrc: string,
    special?: Episode,
  ): Promise<EpisodeLocal | null> {
    const episodes = await this.episodesRepo.findAllBySeasonId(season.id);

    // The number of the file wins over the one of the metadata. 0 is a valid number (S02E00)
    const episodeNumber =
      realEpisode !== undefined && realEpisode !== -1
        ? realEpisode
        : (episodeMetadata.episode_number ?? 0);

    let episode: EpisodeLocal | null =
      episodes?.find((ep) => ep.episodeNumber === episodeNumber) ?? null;

    if (episode) return episode;

    // Create episode if not exists
    episode = await this.episodesRepo.create({
      seasonId: season.id,
      seasonNumber: season.seasonNumber,
      name: episodeMetadata.name ?? '',
      overview: episodeMetadata.overview ?? '',
      year: episodeMetadata.air_date ?? '',
      score: episodeMetadata.vote_average ? (episodeMetadata.vote_average * 10.0) / 10.0 : 0,
      episodeNumber,
      ...(special && {
        metadataSeason: special.season_number,
        metadataEpisode: special.episode_number,
      }),
    });

    if (!episode) return null;

    // Update library cache
    library.analyzedFiles = {
      ...library.analyzedFiles,
      [videoSrc]: episode.id,
    };

    await this.librariesRepo.addAnalyzedFile(library.id, videoSrc, episode.id);

    return episode;
  }

  //#endregion

  //#region METADATA RESOLUTION

  /**
   * Resolves episode metadata from filename
   */
  async resolveEpisodeMetadata(
    show: Series,
    videoSrc: string,
    seasonsMetadata: TvSeasonResponse[],
    seasonsIndex: Map<number, { season: TvSeasonResponse; episodesMap: Map<number, Episode> }>,
    cumulativeEpisodes: number[],
    episodesGroup?: EpisodeGroupResponse,
  ): Promise<{
    seasonMetadata: TvSeasonResponse | null;
    episodeMetadata: Episode | null;
    realSeason?: number;
    realEpisode?: number;
  }> {
    let seasonMetadata: TvSeasonResponse | null = null;
    let episodeMetadata: Episode | null = null;
    // Only set when the file name has the season (S00E05): season 0 (specials) is a real season
    let realSeason: number | undefined;
    let realEpisode: number | undefined = -1;

    const fullName = path.parse(videoSrc).name;
    const seasonEpisode: [number, number?] = this.extractEpisodeSeason(fullName);

    if (Number.isNaN(seasonEpisode[0])) {
      logger.debug(
        {
          seriesId: show.id,
          videoSrc,
          filename: fullName,
        },
        'Could not extract season/episode from filename',
      );
      return { seasonMetadata, episodeMetadata };
    }

    // Absolute number
    if (seasonEpisode[1] === undefined) {
      const absoluteNumber = seasonEpisode[0];
      realEpisode = absoluteNumber;

      const result = this.getSeasonEpisodeByAbsoluteNumber(
        absoluteNumber,
        seasonsMetadata,
        cumulativeEpisodes,
      );

      if (!result) {
        logger.debug(
          {
            seriesId: show.id,
            videoSrc,
            filename: fullName,
            detectedAbsoluteEpisode: absoluteNumber,
            totalSeasonsMetadata: seasonsMetadata.length,
            cumulativeEpisodes,
          },
          'Could not find absolute episode number in metadata',
        );
        return { seasonMetadata, episodeMetadata };
      }

      seasonMetadata = result.season;
      episodeMetadata = result.episode;
    } else {
      // Season + Episode
      const [episodeNumber, seasonNumber] = seasonEpisode;
      realSeason = seasonNumber;
      realEpisode = episodeNumber;

      const resolved = await this.resolveEpisodeBySeasonEpisode(
        show,
        episodeNumber,
        seasonNumber,
        seasonsMetadata,
        seasonsIndex,
        episodesGroup,
      );

      if (!resolved?.episodeMetadata || !resolved?.seasonMetadata) {
        logger.debug(
          {
            seriesId: show.id,
            videoSrc,
            filename: fullName,
            detectedSeason: seasonNumber,
            detectedEpisode: episodeNumber,
            foundInSeasonIndex: !!seasonsIndex.get(seasonNumber),
            seasonInMetadata: seasonsMetadata.some((s) => s.season_number === seasonNumber),
            hasEpisodeGroupId: !!show.episodeGroupId,
          },
          'Could not resolve season/episode in metadata',
        );
      }

      seasonMetadata = resolved?.seasonMetadata ?? null;
      episodeMetadata = resolved?.episodeMetadata ?? null;
    }

    return { seasonMetadata, episodeMetadata, realSeason, realEpisode };
  }

  /**
   * Resolves a file whose season and episode are not in TMDb. The file is registered as it is
   * numbered on disk, with the metadata of the special it corresponds to if there is a clear one.
   */
  private async resolveUnlistedEpisode(
    library: Library,
    resolution: EpisodeResolution,
    seasonsMetadata: TvSeasonResponse[],
  ): Promise<EpisodeResolution | null> {
    const { videoSrc, realSeason, realEpisode } = resolution;
    if (realSeason === undefined || realEpisode === undefined) return null;
    // Only for explicit numbers: other names with two numbers are not a reliable season and episode
    if (!EXPLICIT_SEASON_EPISODE.test(path.parse(videoSrc).name)) return null;

    const seasonMetadata =
      seasonsMetadata.find((s) => s.season_number === realSeason) ??
      ({
        season_number: realSeason,
        name: localizeSeasonName('', realSeason, library.language),
        episodes: [],
      } as TvSeasonResponse);

    const special = matchSpecialEpisode(
      seasonsMetadata,
      realSeason,
      realEpisode,
      await getOnlyRuntime(videoSrc),
    );
    if (special) {
      return { ...resolution, seasonMetadata, episodeMetadata: special, metadataSource: 'special' };
    }

    const label = library.language.startsWith('es') ? 'Episodio' : 'Episode';
    return {
      ...resolution,
      seasonMetadata,
      episodeMetadata: {
        name: `${label} ${realEpisode}`,
        season_number: realSeason,
        episode_number: realEpisode,
      },
      metadataSource: 'none',
    };
  }

  /**
   * Resolves episode by season and episode number
   */
  async resolveEpisodeBySeasonEpisode(
    show: Series,
    episodeNumber: number,
    seasonNumber: number,
    seasonsMetadata: TvSeasonResponse[],
    seasonsIndex: Map<number, { season: TvSeasonResponse; episodesMap: Map<number, Episode> }>,
    episodesGroup?: EpisodeGroupResponse,
  ): Promise<{
    seasonMetadata?: TvSeasonResponse;
    episodeMetadata?: Episode;
  } | null> {
    const exists = seasonsMetadata.some((s) => s.season_number === seasonNumber);

    if (!exists && show.episodeGroupId) {
      const resolvedGroup =
        episodesGroup ?? (await this.metadataProvider.getEpisodeGroup(show.episodeGroupId));
      if (!resolvedGroup) return null;
      return this.findEpisodeInGroup(resolvedGroup, seasonNumber, episodeNumber, seasonsMetadata);
    }

    return this.findEpisodeInSeasonIndex(seasonsIndex, seasonNumber, episodeNumber);
  }

  private findEpisodeInGroup(
    episodesGroup: EpisodeGroupResponse,
    seasonNumber: number,
    episodeNumber: number,
    seasonsMetadata: TvSeasonResponse[],
  ): { seasonMetadata?: TvSeasonResponse; episodeMetadata?: Episode } | null {
    if (!episodesGroup?.groups) return null;

    for (const group of episodesGroup.groups) {
      if (group.order !== seasonNumber || !group.episodes) continue;
      const ep = group.episodes.find((e) => e.order && e.order + 1 === episodeNumber);
      if (!ep) continue;

      const seasonMeta = seasonsMetadata.find((s) => s.season_number === ep.season_number);
      const episodeMeta = seasonMeta?.episodes?.find((e) => e.episode_number === ep.episode_number);

      if (seasonMeta && episodeMeta) {
        return { seasonMetadata: seasonMeta, episodeMetadata: episodeMeta };
      }
    }

    return null;
  }

  private findEpisodeInSeasonIndex(
    seasonsIndex: Map<number, { season: TvSeasonResponse; episodesMap: Map<number, Episode> }>,
    seasonNumber: number,
    episodeNumber: number,
  ): { seasonMetadata?: TvSeasonResponse; episodeMetadata?: Episode } | null {
    const seasonData = seasonsIndex.get(seasonNumber);
    const episodeMetadata = seasonData?.episodesMap.get(episodeNumber);

    if (!seasonData || !episodeMetadata) return null;

    return {
      seasonMetadata: seasonData.season,
      episodeMetadata,
    };
  }

  /**
   * Get season and episode by absolute number
   */
  getSeasonEpisodeByAbsoluteNumber(
    absoluteNumber: number,
    seasonsMetadata: TvSeasonResponse[],
    cumulative: number[],
  ): { season: TvSeasonResponse; episode: MovieDBEpisode } | null {
    const standardSeasons = this.getStandardSeasonsForAbsoluteMapping(seasonsMetadata);

    for (let i = 0; i < cumulative.length; i++) {
      if (absoluteNumber <= cumulative[i]) {
        const season = standardSeasons[i];
        if (!season?.episodes) {
          continue;
        }

        const previousCount = i > 0 ? cumulative[i - 1] : 0;
        const episodeIndex = absoluteNumber - previousCount - 1; // Index from 0
        if (season.episodes?.[episodeIndex]) {
          return { season, episode: season.episodes[episodeIndex] };
        }
      }
    }
    return null;
  }

  /**
   * Extracts episode and season numbers from filename
   * @param filename path to the video file
   * @returns array of 1 to 2 elements corresponding with the episode and season number detected, or NaN if no episode was found
   */
  extractEpisodeSeason(filename: string): [number, number?] {
    const regexPatterns = [
      /[Ss](\d{1,4})[Ee](\d{1,4})(?:v\d+)?/i, // S01E02, s1e2, S1.E2, S01E01v2
      /[Ss](\d{1,4})[.]?E(\d{1,4})(?:v\d+)?/i, // S1.E2, S1.E2v1
      /[Ss](\d{1,4})[\s-]+Ep?(\d{1,4})(?:v\d+)?/i, // S01 E02, S1 E2
      /-\s?(\d{1,4})(?:v\d+)?(?!p)/, // - 01, - 01v1 (anime style)
      /(?:\b|^)(\d{1,4})(?:[^\d]+(\d{1,4}))?/i, // General case
    ];

    for (const regex of regexPatterns) {
      const match = filename.match(regex);
      if (match) {
        let episode: number;
        let season: number | undefined;
        if (regex === regexPatterns[3] && match[2]) {
          // Only consider the second number as the episode if two numbers are present
          episode = parseInt(match[2], 10);
          season = undefined;
        } else {
          episode = parseInt(match[2] ?? match[1], 10);
          season = match[2] ? parseInt(match[1], 10) : undefined;
        }
        return season !== undefined ? [episode, season] : [episode];
      }
    }

    return [NaN];
  }

  //#endregion

  //#region INDEXING HELPERS

  /**
   * Function to index seasons by season number and episode number for faster access
   * @param seasonsMetadata Metadata of seasons
   * @returns Index of seasons by season number and episode number
   */
  indexSeasons(
    seasonsMetadata: TvSeasonResponse[],
  ): Map<number, { season: TvSeasonResponse; episodesMap: Map<number, MovieDBEpisode> }> {
    const index = new Map<
      number,
      { season: TvSeasonResponse; episodesMap: Map<number, MovieDBEpisode> }
    >();

    for (const season of seasonsMetadata) {
      if (season.season_number != null) {
        const episodesMap = new Map<number, MovieDBEpisode>();
        if (season.episodes) {
          for (const episode of season.episodes) {
            if (episode.episode_number != null) {
              episodesMap.set(episode.episode_number, episode);
            }
          }
        }
        index.set(season.season_number, { season, episodesMap });
      }
    }
    return index;
  }

  /**
   * Function to calculate the cumulative number of episodes in each season
   * @param seasonsMetadata Metadata of seasons
   * @returns Cumulative number of episodes in each season
   */
  buildCumulativeEpisodes(seasonsMetadata: TvSeasonResponse[]): number[] {
    const standardSeasons = this.getStandardSeasonsForAbsoluteMapping(seasonsMetadata);
    const cumulative: number[] = [];
    let total = 0;

    for (const season of standardSeasons) {
      total += season.episodes?.length ?? 0;
      cumulative.push(total);
    }
    return cumulative;
  }

  /**
   * Returns regular seasons ordered by season number.
   * Season 0 (specials) is excluded from absolute episode mapping.
   */
  private getStandardSeasonsForAbsoluteMapping(
    seasonsMetadata: TvSeasonResponse[],
  ): TvSeasonResponse[] {
    return seasonsMetadata
      .filter(
        (season) =>
          season.season_number != null &&
          season.season_number >= 1 &&
          Array.isArray(season.episodes) &&
          season.episodes.length > 0,
      )
      .sort((a, b) => (a.season_number ?? 0) - (b.season_number ?? 0));
  }

  //#endregion
}
