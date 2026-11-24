/** Progress below this is not worth resuming (accidental opens). */
const MIN_RESUME_SECONDS = 5;
/** Saved progress this close to the end (or beyond) means "finished": start over. */
const END_MARGIN_SECONDS = 30;
const END_MARGIN_RATIO = 0.05;

/**
 * Where playback should start for a video with saved progress.
 * Starting at the very end would leave the player stuck on the last frame (EOF), so progress in the
 * final stretch, invalid values, or values past the known duration restart the video from 0.
 *
 * @param timeWatchedSeconds saved progress for the user, in seconds
 * @param runtimeMinutes known runtime of the video in minutes (0/undefined when unknown)
 */
export function resolveResumePosition(
  timeWatchedSeconds: number | null | undefined,
  runtimeMinutes: number | null | undefined,
): number {
  if (typeof timeWatchedSeconds !== 'number' || !Number.isFinite(timeWatchedSeconds)) return 0;
  if (timeWatchedSeconds < MIN_RESUME_SECONDS) return 0;

  const durationSeconds =
    typeof runtimeMinutes === 'number' && Number.isFinite(runtimeMinutes) && runtimeMinutes > 0
      ? runtimeMinutes * 60
      : 0;

  if (durationSeconds > 0) {
    const margin = Math.max(END_MARGIN_SECONDS, durationSeconds * END_MARGIN_RATIO);
    if (timeWatchedSeconds >= durationSeconds - margin) return 0;
  }

  return timeWatchedSeconds;
}
