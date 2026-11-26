import {
  findMatchingTrackIndex,
  normalizeLanguage,
  normalizeSubtitleMode,
  resolveDefaultTracks,
  type AudioTrack,
  type SubtitleTrack,
  type TrackPreferences,
} from '@seerial/domain';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { In } from 'typeorm';
import { EpisodeModel } from '@/api/v1/episodes/infrastructure/persistence/models/EpisodeModel';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { UserVideoPreferenceModel } from '@/api/v1/users/infrastructure/persistence/models/UserVideoPreferenceModel';
import { VideoModel } from '@/api/v1/videos/infrastructure/persistence/models/VideoModel';
import logger from '@/utils/logger';

/** Rows of a bulk lookup are read and written in chunks to stay far from SQLite's variable limit. */
const CHUNK_SIZE = 300;

type TrackedVideo = Pick<
  VideoModel,
  'id' | 'audioTracks' | 'subtitleTracks' | 'selectedAudioTrack' | 'selectedSubtitleTrack'
>;

const VIDEO_COLUMNS = [
  'v.id',
  'v.audioTracks',
  'v.subtitleTracks',
  'v.selectedAudioTrack',
  'v.selectedSubtitleTrack',
];

interface LibraryTrackConfig {
  id: string;
  language?: string;
  preferAudioLan?: string | null;
  preferSubLan?: string | null;
  subsMode?: string | null;
}

/** Preferences of a series: its own when it has them, the ones of its library otherwise. */
const seriesPreferences = (series: SeriesModel, library: LibraryTrackConfig): TrackPreferences => ({
  preferAudioLan: series.preferAudioLan || library.preferAudioLan || '',
  preferSubLan: series.preferSubLan || library.preferSubLan || '',
  subsMode: series.subsMode || library.subsMode || 'autoSubs',
});

const libraryPreferences = (library: LibraryTrackConfig): TrackPreferences => ({
  preferAudioLan: library.preferAudioLan || '',
  preferSubLan: library.preferSubLan || '',
  subsMode: library.subsMode || 'autoSubs',
});

const chunks = <T>(items: T[], size = CHUNK_SIZE): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

/**
 * Audio / subtitle tracks selected by default for each video, following the preferences of its
 * library or series (preferred audio language, preferred subtitles language and subtitle mode), and
 * the propagation of what a user picks to the rest of the episodes of a series.
 */
export class TrackSelectionService {
  private constructor() {}

  /**
   * Old versions of the web client saved the name of the language ("Español") and the label of
   * the subtitle mode ("Con audio extranjero") in the libraries instead of their codes and keys.
   * Rewrites them, and selects the default tracks of the videos that have none yet.
   */
  static async prepareLibraries(): Promise<void> {
    const libraries = await LibraryModel.find();

    for (const library of libraries) {
      if (library.type === 'Music') continue;

      const fixed = {
        preferAudioLan: library.preferAudioLan ? normalizeLanguage(library.preferAudioLan) : library.preferAudioLan,
        preferSubLan: library.preferSubLan ? normalizeLanguage(library.preferSubLan) : library.preferSubLan,
        subsMode: library.subsMode ? normalizeSubtitleMode(library.subsMode) : library.subsMode,
      };
      if (
        fixed.preferAudioLan !== library.preferAudioLan ||
        fixed.preferSubLan !== library.preferSubLan ||
        fixed.subsMode !== library.subsMode
      ) {
        await LibraryModel.update(library.id, fixed);
      }

      await TrackSelectionService.applyToLibrary(library.id);
    }
  }

  /**
   * Selects the default tracks of the videos of a library (and of the videos of its series, which
   * may have their own preferences).
   *
   * @param force - Recalculates every video (the preferences changed). Otherwise only the videos
   * that have no selection yet are touched, which is what a scan needs.
   */
  static async applyToLibrary(libraryId: string, force = false): Promise<number> {
    const library = await LibraryModel.findOne({ where: { id: libraryId } });
    if (!library || library.type === 'Music') return 0;

    if (library.type === 'Movies') {
      const preferences = libraryPreferences(library);
      const main = TrackSelectionService.videoQuery(force).innerJoin('v.movie', 'm').andWhere('m.libraryId = :libraryId', { libraryId });
      const extras = TrackSelectionService.videoQuery(force).innerJoin('v.extra', 'x').andWhere('x.libraryId = :libraryId', { libraryId });
      const updated = await TrackSelectionService.applyDefaults(await main.getMany(), preferences, library.language);
      return updated + (await TrackSelectionService.applyDefaults(await extras.getMany(), preferences, library.language));
    }

    const seriesList = await SeriesModel.find({ where: { libraryId } });
    let updated = 0;
    for (const series of seriesList) {
      updated += await TrackSelectionService.applyToSeriesVideos(series, library, force);
    }
    return updated;
  }

  /** Same as {@link applyToLibrary} for the episodes of a single series. */
  static async applyToSeries(seriesId: string, force = false): Promise<number> {
    const series = await SeriesModel.findOne({ where: { id: seriesId } });
    if (!series) return 0;

    const library = await LibraryModel.findOne({ where: { id: series.libraryId } });
    if (!library) return 0;

    return TrackSelectionService.applyToSeriesVideos(series, library, force);
  }

  private static async applyToSeriesVideos(
    series: SeriesModel,
    library: LibraryTrackConfig,
    force: boolean,
  ): Promise<number> {
    const videos = await TrackSelectionService.videoQuery(force)
      .innerJoin('v.episode', 'e')
      .innerJoin('e.season', 's')
      .andWhere('s.seriesId = :seriesId', { seriesId: series.id })
      .getMany();

    return TrackSelectionService.applyDefaults(videos, seriesPreferences(series, library), library.language);
  }

  private static videoQuery(force: boolean): SelectQueryBuilder<VideoModel> {
    const query = VideoModel.createQueryBuilder('v')
      .select(VIDEO_COLUMNS)
      .where('v.audioTracks IS NOT NULL');
    if (!force) {
      query.andWhere('v.selectedAudioTrack IS NULL AND v.selectedSubtitleTrack IS NULL');
    }
    return query;
  }

  /** Writes the selection of the videos that do not have it yet (or have a different one). */
  private static async applyDefaults(
    videos: TrackedVideo[],
    preferences: TrackPreferences,
    appLanguage?: string,
  ): Promise<number> {
    const changes: { id: string; selectedAudioTrack: number; selectedSubtitleTrack: number }[] = [];

    for (const video of videos) {
      if (!video.audioTracks || video.audioTracks.length === 0) continue;

      const { audioIndex, subtitleIndex } = resolveDefaultTracks(video, preferences, { appLanguage });
      if (audioIndex === video.selectedAudioTrack && subtitleIndex === video.selectedSubtitleTrack) continue;
      changes.push({ id: video.id, selectedAudioTrack: audioIndex, selectedSubtitleTrack: subtitleIndex });
    }

    if (changes.length === 0) return 0;

    await VideoModel.getRepository().manager.transaction(async (manager) => {
      for (const { id, ...selection } of changes) {
        await manager.update(VideoModel, id, selection);
      }
    });
    logger.info({ videos: changes.length }, 'Default audio and subtitle tracks selected');
    return changes.length;
  }

  /**
   * Applies what a user picked in an episode to the other episodes of its series, looking for the
   * same tracks in each one (same language, forced or not, and the same position among the ones
   * that share it). Episodes without such a track keep what they had. Movies are not propagated.
   */
  static async propagate(
    userId: string,
    videoId: string,
    selection: { selectedAudioTrack?: number; selectedSubtitleTrack?: number },
  ): Promise<number> {
    const source = await VideoModel.createQueryBuilder('v')
      .select([...VIDEO_COLUMNS, 'v.episodeId'])
      .where('v.id = :videoId', { videoId })
      .getOne();
    if (!source?.episodeId) return 0;

    const episode = await EpisodeModel.findOne({ where: { id: source.episodeId }, select: { seasonId: true } });
    const season = episode
      ? await SeasonModel.findOne({ where: { id: episode.seasonId }, select: { seriesId: true } })
      : null;
    if (!season) return 0;

    const siblings = await VideoModel.createQueryBuilder('v')
      .select(VIDEO_COLUMNS)
      .innerJoin('v.episode', 'e')
      .innerJoin('e.season', 's')
      .where('v.id != :videoId', { videoId })
      .andWhere('v.audioTracks IS NOT NULL')
      .andWhere('s.seriesId = :seriesId', { seriesId: season.seriesId })
      .getMany();
    if (siblings.length === 0) return 0;

    const matches = new Map<string, { audio?: number; subtitle?: number }>();
    for (const sibling of siblings) {
      const match = TrackSelectionService.matchSelection(source, sibling, selection);
      if (match.audio !== undefined || match.subtitle !== undefined) matches.set(sibling.id, match);
    }
    if (matches.size === 0) return 0;

    await VideoModel.getRepository().manager.transaction(async (manager) => {
      for (const batch of chunks([...matches.keys()])) {
        await TrackSelectionService.saveUserSelections(manager, userId, batch, matches);
      }
    });
    logger.info({ videoId, videos: matches.size }, 'Track selection propagated to the series');
    return matches.size;
  }

  private static matchSelection(
    source: TrackedVideo,
    target: TrackedVideo,
    selection: { selectedAudioTrack?: number; selectedSubtitleTrack?: number },
  ): { audio?: number; subtitle?: number } {
    const result: { audio?: number; subtitle?: number } = {};

    if (selection.selectedAudioTrack !== undefined) {
      const index = findMatchingTrackIndex(
        (source.audioTracks ?? []) as AudioTrack[],
        selection.selectedAudioTrack,
        (target.audioTracks ?? []) as AudioTrack[],
      );
      if (index !== -1) result.audio = index;
    }

    if (selection.selectedSubtitleTrack === -1) {
      result.subtitle = -1;
    } else if (selection.selectedSubtitleTrack !== undefined) {
      const index = findMatchingTrackIndex(
        (source.subtitleTracks ?? []) as SubtitleTrack[],
        selection.selectedSubtitleTrack,
        (target.subtitleTracks ?? []) as SubtitleTrack[],
      );
      if (index !== -1) result.subtitle = index;
    }

    return result;
  }

  private static async saveUserSelections(
    manager: EntityManager,
    userId: string,
    videoIds: string[],
    matches: Map<string, { audio?: number; subtitle?: number }>,
  ): Promise<void> {
    const existing = await manager.find(UserVideoPreferenceModel, {
      where: { userId, videoId: In(videoIds) },
    });
    const byVideo = new Map(existing.map((row) => [row.videoId, row]));

    const rows = videoIds.map((videoId) => {
      const row =
        byVideo.get(videoId) ??
        manager.create(UserVideoPreferenceModel, {
          userId,
          videoId,
          selectedAudioTrack: null,
          selectedSubtitleTrack: null,
        });
      const match = matches.get(videoId);
      if (match?.audio !== undefined) row.selectedAudioTrack = match.audio;
      if (match?.subtitle !== undefined) row.selectedSubtitleTrack = match.subtitle;
      return row;
    });

    await manager.save(rows);
  }
}
