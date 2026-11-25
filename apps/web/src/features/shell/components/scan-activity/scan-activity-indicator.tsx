import { useIsAdmin } from '@seerial/hooks';
import { useMusicStore, useWebSocketStore } from '@seerial/stores';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

const RECONNECT_DELAY_MS = 5000;

/**
 * Floating loading circle (bottom right) shown while the server scans a library or downloads
 * music in the background. Clicking it opens a box above with what the server reports.
 */
function ScanActivityIndicator() {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const hasSong = useMusicStore((state) => Boolean(state.currentSong));
  const { activity, wsConnected, connectWS, loadScanActivity } = useWebSocketStore(
    (state) => ({
      activity: state.scanActivity,
      wsConnected: state.wsConnected,
      connectWS: state.connectWS,
      loadScanActivity: state.loadScanActivity,
    }),
    shallow,
  );
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The server reports its activity through the websocket: stay connected (and reconnect if the
  // server restarts), and read the current state, which may have started before connecting.
  useEffect(() => {
    if (!isAdmin) return;

    if (wsConnected) {
      void loadScanActivity();
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      connectWS().catch(() => {
        if (!cancelled) timer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };
    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAdmin, wsConnected, connectWS, loadScanActivity]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  const { scan, music, queued } = activity;
  const active = Boolean(scan || music);

  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  if (!isAdmin || !active) return null;

  return (
    <div
      ref={containerRef}
      className={`fixed right-5 z-50 flex flex-col items-end gap-2 ${hasSong ? 'bottom-28' : 'bottom-5'}`}
      data-testid="scan-activity"
    >
      {open && (
        <div
          role="status"
          aria-label={t('backgroundActivity')}
          className="w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
        >
          <div className="flex flex-col gap-2">
            {scan && (
              <p>
                {t('scanningLibrary', {
                  name: scan.libraryName,
                  current: scan.processed,
                  total: scan.total,
                  interpolation: { escapeValue: false },
                })}
              </p>
            )}
            {music && (
              <p>
                {t('downloadingMusic', {
                  name: music.libraryName,
                  current: music.completed,
                  total: music.total,
                  interpolation: { escapeValue: false },
                })}
              </p>
            )}
            {queued > 0 && (
              <p className="text-muted-foreground text-xs">{t('queuedScans', { count: queued })}</p>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('backgroundActivity')}
        aria-expanded={open}
        className="flex size-12 cursor-pointer items-center justify-center rounded-full border bg-popover shadow-lg transition-colors hover:bg-accent"
      >
        <svg
          className="size-6 animate-spin text-primary"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default ScanActivityIndicator;
