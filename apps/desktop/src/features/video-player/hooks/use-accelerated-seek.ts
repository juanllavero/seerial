import { useCallback, useEffect, useRef } from 'react';

/** A tap jumps this far, as it always did. */
export const SEEK_STEP_SECONDS = 10;
/** Holding shorter than this is still a tap: only the jump above. */
const HOLD_DELAY_MS = 350;
/** Scrub speed when the hold starts, in seconds of video per real second. */
const BASE_SPEED = 20;
/** The speed doubles every this many seconds of holding. */
const DOUBLING_SECONDS = 0.7;
/** 20 minutes of video per second: an hour goes by in 3 seconds. Reached after ~4.5 s. */
const MAX_SPEED = 1200;
/** A seek just sent may not be reflected by mpv yet: chained taps build on it instead. */
const RECENT_COMMIT_MS = 1500;

/** Scrub speed after holding for `heldSeconds` (past the tap delay). */
export function holdSeekSpeed(heldSeconds: number): number {
  return Math.min(MAX_SPEED, BASE_SPEED * 2 ** (Math.max(0, heldSeconds) / DOUBLING_SECONDS));
}

type Direction = 1 | -1;

/** Direction of a plain left/right arrow press, null for any other key or with modifiers. */
function getArrowDirection(event: KeyboardEvent): Direction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowLeft') return -1;
  if (event.key === 'ArrowRight') return 1;
  return null;
}

interface Hold {
  direction: Direction;
  startedAt: number;
  lastTick: number;
  target: number;
  duration: number;
  frame: number | null;
  ready: Promise<void>;
}

interface UseAcceleratedSeekOptions {
  /** Where playback is and how long the video is when the hold starts. */
  getPlaybackState: () => Promise<{ position: number; duration: number }>;
  /** The scrub moved: only the timeline is updated. */
  onPreview: (position: number, duration: number) => void;
  /** The hold ended: seek the player there. */
  onCommit: (position: number) => Promise<void>;
  onStart?: (direction: Direction) => void;
  /** Keys are only listened to while enabled; disabling ends a hold in progress. */
  enabled: boolean;
}

/**
 * Left/right seeking: a tap jumps 10 s, holding scrubs progressively faster. The player only seeks
 * once, on release, so a long scrub does not queue hundreds of seeks on the stream.
 */
export function useAcceleratedSeek({
  getPlaybackState,
  onPreview,
  onCommit,
  onStart,
  enabled,
}: UseAcceleratedSeekOptions) {
  const holdRef = useRef<Hold | null>(null);
  const lastCommitRef = useRef<{ position: number; at: number } | null>(null);
  const callbacksRef = useRef({ getPlaybackState, onPreview, onCommit, onStart });
  callbacksRef.current = { getPlaybackState, onPreview, onCommit, onStart };

  const tick = useCallback((hold: Hold) => {
    if (holdRef.current !== hold) return;

    const now = performance.now();
    const heldMs = now - hold.startedAt;
    if (heldMs > HOLD_DELAY_MS) {
      const elapsed = (now - Math.max(hold.lastTick, hold.startedAt + HOLD_DELAY_MS)) / 1000;
      const speed = holdSeekSpeed((heldMs - HOLD_DELAY_MS) / 1000);
      hold.target = Math.max(
        0,
        Math.min(hold.duration, hold.target + hold.direction * speed * elapsed),
      );
      callbacksRef.current.onPreview(hold.target, hold.duration);
    }
    hold.lastTick = now;
    hold.frame = requestAnimationFrame(() => tick(hold));
  }, []);

  const endHold = useCallback(async () => {
    const hold = holdRef.current;
    if (!hold) return;
    holdRef.current = null;
    if (hold.frame !== null) cancelAnimationFrame(hold.frame);

    await hold.ready;
    lastCommitRef.current = { position: hold.target, at: performance.now() };
    await callbacksRef.current.onCommit(hold.target);
  }, []);

  const startHold = useCallback(
    (direction: Direction, withJump: boolean) => {
      const hold: Hold = {
        direction,
        startedAt: performance.now(),
        lastTick: 0,
        target: 0,
        duration: 0,
        frame: null,
        ready: Promise.resolve(),
      };
      holdRef.current = hold;
      callbacksRef.current.onStart?.(direction);

      hold.ready = callbacksRef.current
        .getPlaybackState()
        .then(({ position, duration }) => {
          const recent = lastCommitRef.current;
          const base =
            recent && performance.now() - recent.at < RECENT_COMMIT_MS ? recent.position : position;
          const jump = withJump ? direction * SEEK_STEP_SECONDS : 0;
          hold.duration = duration;
          hold.target = Math.max(0, Math.min(duration, base + jump));
          callbacksRef.current.onPreview(hold.target, duration);
          if (holdRef.current === hold) {
            hold.lastTick = performance.now();
            hold.frame = requestAnimationFrame(() => tick(hold));
          }
        })
        .catch((error) => {
          console.error('Seek failed:', error);
          if (holdRef.current === hold) holdRef.current = null;
        });
    },
    [tick],
  );

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = getArrowDirection(event);
      if (direction === null) return;
      event.preventDefault();

      const current = holdRef.current;
      if (current?.direction === direction) return; // key repeat of the hold in progress
      if (current) void endHold();
      // A repeat without a hold: the first press only revealed the controls, start scrubbing now
      startHold(direction, !event.repeat);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
      if (direction !== null && holdRef.current?.direction === direction) void endHold();
    };

    const handleBlur = () => void endHold();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      void endHold();
    };
  }, [enabled, startHold, endHold]);

  const isHolding = useCallback(() => holdRef.current !== null, []);

  return { isHolding };
}
