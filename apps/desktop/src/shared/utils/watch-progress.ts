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
