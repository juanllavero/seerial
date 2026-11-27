import { useEffect } from 'react';

const IDLE_CLASS = 'cursor-idle';
const DEFAULT_IDLE_MS = 2500;

/** Hides the mouse pointer after `idleMs` without moving it, and shows it again on movement. */
export function useIdleCursor(enabled = true, idleMs = DEFAULT_IDLE_MS) {
  useEffect(() => {
    if (!enabled) return;

    const root = document.documentElement;
    let timeout: number | undefined;

    const scheduleHide = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => root.classList.add(IDLE_CLASS), idleMs);
    };

    const handleActivity = () => {
      root.classList.remove(IDLE_CLASS);
      scheduleHide();
    };

    scheduleHide();
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('wheel', handleActivity, { passive: true });

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('wheel', handleActivity);
      root.classList.remove(IDLE_CLASS);
    };
  }, [enabled, idleMs]);
}
