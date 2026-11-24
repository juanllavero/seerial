import { In } from 'typeorm';
import { UserVideoPreferenceModel } from '@/api/v1/users/infrastructure/persistence/models/UserVideoPreferenceModel';

type TrackedVideo = {
  id: string;
  audioTracks?: unknown[];
  selectedAudioTrack?: number | null;
  selectedSubtitleTrack?: number | null;
};

const isVideoLike = (node: Record<string, unknown>): node is TrackedVideo =>
  typeof node.id === 'string' && Array.isArray(node.audioTracks);

/**
 * Per-user audio/subtitle track selection.
 * The selection is stored apart from the video and overlaid on the responses of each user.
 */
export class UserVideoPreferencesService {
  private constructor() {}

  /** Saves the tracks the user picked. Fields left undefined are not touched. */
  static async save(
    userId: string,
    videoId: string,
    selection: { selectedAudioTrack?: number; selectedSubtitleTrack?: number },
  ): Promise<void> {
    const existing = await UserVideoPreferenceModel.findOne({ where: { userId, videoId } });
    const row =
      existing ??
      UserVideoPreferenceModel.create({
        userId,
        videoId,
        selectedAudioTrack: null,
        selectedSubtitleTrack: null,
      });

    if (selection.selectedAudioTrack !== undefined) {
      row.selectedAudioTrack = selection.selectedAudioTrack;
    }
    if (selection.selectedSubtitleTrack !== undefined) {
      row.selectedSubtitleTrack = selection.selectedSubtitleTrack;
    }
    await row.save();
  }

  /**
   * Replaces `selectedAudioTrack` / `selectedSubtitleTrack` of every video found anywhere inside
   * `payload` (a video, a movie with videos, a series with seasons and episodes...) with what the
   * user picked. Videos the user never touched keep the default selection.
   */
  static async overlay<T>(userId: string, payload: T): Promise<T> {
    const videos = new Map<string, TrackedVideo[]>();
    UserVideoPreferencesService.collect(payload, videos, new Set());
    if (videos.size === 0) return payload;

    const rows = await UserVideoPreferenceModel.find({
      where: { userId, videoId: In([...videos.keys()]) },
    });
    for (const row of rows) {
      for (const video of videos.get(row.videoId) ?? []) {
        if (row.selectedAudioTrack !== null) video.selectedAudioTrack = row.selectedAudioTrack;
        if (row.selectedSubtitleTrack !== null) {
          video.selectedSubtitleTrack = row.selectedSubtitleTrack;
        }
      }
    }
    return payload;
  }

  private static collect(
    node: unknown,
    found: Map<string, TrackedVideo[]>,
    seen: Set<unknown>,
  ): void {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) UserVideoPreferencesService.collect(item, found, seen);
      return;
    }

    const record = node as Record<string, unknown>;
    if (isVideoLike(record)) {
      const list = found.get(record.id) ?? [];
      list.push(record);
      found.set(record.id, list);
    }
    for (const [key, value] of Object.entries(record)) {
      // Track lists and watch lists are large and never contain videos
      if (key === 'audioTracks' || key === 'subtitleTracks' || key === 'watchLists') continue;
      UserVideoPreferencesService.collect(value, found, seen);
    }
  }
}
