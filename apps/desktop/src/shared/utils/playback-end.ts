/** EOF within this many seconds of the known duration is a real end of the video. */
const END_TOLERANCE_SECONDS = 10;

/**
 * mpv reports `eof-reached` both when the video finished and when the stream was cut (server down,
 * connection dropped, truncated file). Only the former may mark the video as watched.
 */
export function isGenuineEnd(
  position: number | null | undefined,
  duration: number | null | undefined,
): boolean {
  if (typeof position !== 'number' || typeof duration !== 'number') return false;
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return false;
  return duration - position <= END_TOLERANCE_SECONDS;
}
