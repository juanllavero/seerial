import type { Video } from '@seerial/domain';

export interface WatchProgress {
  /** Minutes. */
  duration: number;
  /** Seconds. */
  timeWatched: number;
}

/** Progress of a video the user has started and not finished. */
export function getWatchProgress(
  video: Video | null | undefined,
  userId: string | undefined,
): WatchProgress | undefined {
  const watch = video?.watchLists?.find((item) => item.userId === userId);

  if (!video?.runtime || !watch || watch.watched || !(watch.timeWatched > 0)) return undefined;

  return { duration: video.runtime, timeWatched: watch.timeWatched };
}

/** Share of the video below which a started video does not show its progress bar yet. */
const MIN_VISIBLE_PROGRESS_RATIO = 0.08;
const MIN_VISIBLE_PROGRESS_FLOOR_MINUTES = 1;
const MIN_VISIBLE_PROGRESS_CAP_MINUTES = 5;

/**
 * Whether the progress is worth a bar on the cards: opening a video for a moment (or watching the
 * opening credits) should not mark it as started. 8% of its length, between 1 and 5 minutes:
 * ~2 min for a 24 min episode, 5 min for any film of an hour or more.
 *
 * @param durationMinutes length of the video
 * @param timeWatchedSeconds progress of the user
 */
export function isWatchProgressVisible(
  durationMinutes: number,
  timeWatchedSeconds: number,
): boolean {
  if (!(durationMinutes > 0) || !(timeWatchedSeconds > 0)) return false;

  const thresholdMinutes = Math.min(
    MIN_VISIBLE_PROGRESS_CAP_MINUTES,
    Math.max(MIN_VISIBLE_PROGRESS_FLOOR_MINUTES, durationMinutes * MIN_VISIBLE_PROGRESS_RATIO),
  );
  return timeWatchedSeconds / 60 >= thresholdMinutes;
}
