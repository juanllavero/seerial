import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Longest wait for the update server before opening the app anyway (offline, GitHub down...). */
const CHECK_TIMEOUT_MS = 6000;

export type UpdatePhase =
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'restarting'
  | 'error'
  | 'done';

export interface AppUpdaterState {
  phase: UpdatePhase;
  currentVersion: string | null;
  newVersion: string | null;
  /** Bytes downloaded / total (total is null when the server does not send it). */
  downloaded: number;
  total: number | null;
  error: string | null;
}

const INITIAL: AppUpdaterState = {
  phase: 'checking',
  currentVersion: null,
  newVersion: null,
  downloaded: 0,
  total: null,
  error: null,
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Checks for a new version once, when the app starts. If there is one it is downloaded and
 * installed right away and the app restarts; otherwise (or if the check cannot be done) the app
 * opens normally. Nothing is checked while the app is running.
 */
export function useAppUpdater() {
  // Development builds are never updated
  const [state, setState] = useState<AppUpdaterState>(
    import.meta.env.DEV ? { ...INITIAL, phase: 'done' } : INITIAL,
  );

  const run = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'checking', error: null, downloaded: 0, total: null }));
    getVersion()
      .then((currentVersion) => setState((s) => ({ ...s, currentVersion })))
      .catch(() => undefined);

    let update: Awaited<ReturnType<typeof check>> = null;
    try {
      update = await withTimeout(check(), CHECK_TIMEOUT_MS);
    } catch (error) {
      console.warn('[updater] check failed, starting without updating:', error);
    }
    if (!update) {
      setState((s) => ({ ...s, phase: 'done' }));
      return;
    }

    setState((s) => ({ ...s, phase: 'downloading', newVersion: update.version }));
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            setState((s) => ({ ...s, total: event.data.contentLength ?? null }));
            break;
          case 'Progress':
            setState((s) => ({ ...s, downloaded: s.downloaded + event.data.chunkLength }));
            break;
          case 'Finished':
            setState((s) => ({ ...s, phase: 'installing' }));
            break;
        }
      });
      setState((s) => ({ ...s, phase: 'restarting' }));
      await relaunch();
    } catch (error) {
      console.error('[updater] update failed:', error);
      setState((s) => ({
        ...s,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  // Only once, at startup
  const started = useRef(false);
  useEffect(() => {
    if (started.current || import.meta.env.DEV) return;
    started.current = true;
    void run();
  }, [run]);

  const skip = useCallback(() => setState((s) => ({ ...s, phase: 'done' })), []);

  return { ...state, retry: run, skip };
}
