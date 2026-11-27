import { API, api } from '@seerial/api';
import type { ServerUpdateStatus } from '@seerial/domain';
import { useIsAdmin } from '@seerial/hooks';
import { useMusicStore, useWebSocketStore } from '@seerial/stores';
import { ArrowRight, Loader2, RotateCw, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';
import { Button } from '@/shared/ui/button';

const POLL_INTERVAL_MS = 2000;
const SLOW_INSTALL_MS = 3 * 60 * 1000;

/**
 * Floating "update ready" pill (bottom right, above the server activity indicator). The server
 * downloads new versions by itself; an admin decides when to install it, which restarts the
 * server. Meanwhile the page shows a blocking screen and reloads once the new version answers.
 */
function ServerUpdateButton() {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const hasSong = useMusicStore((state) => Boolean(state.currentSong));
  const { update, wsConnected, loadServerUpdate, scanActive } = useWebSocketStore(
    (state) => ({
      update: state.serverUpdate,
      wsConnected: state.wsConnected,
      loadServerUpdate: state.loadServerUpdate,
      scanActive: Boolean(state.scanActivity.scan || state.scanActivity.music),
    }),
    shallow,
  );
  const [open, setOpen] = useState(false);
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The websocket is opened by the activity indicator; read the state when (re)connected
  useEffect(() => {
    if (isAdmin && wsConnected) void loadServerUpdate();
  }, [isAdmin, wsConnected, loadServerUpdate]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  const install = async () => {
    if (!update?.version) return;
    setError(null);
    try {
      await api.post(API.updates.install);
      setOpen(false);
      setInstallingVersion(update.version);
    } catch {
      setError(t('serverUpdateFailed'));
    }
  };

  if (installingVersion) return <InstallingScreen version={installingVersion} />;
  if (!isAdmin || update?.state !== 'ready' || !update.version) return null;

  const bottom = hasSong
    ? scanActive
      ? 'bottom-44'
      : 'bottom-28'
    : scanActive
      ? 'bottom-[5.25rem]'
      : 'bottom-5';
  const notes = (update.notes ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);

  return (
    <div
      ref={containerRef}
      className={`fixed right-5 z-50 flex flex-col items-end gap-3 ${bottom}`}
      data-testid="server-update"
    >
      {open && (
        <section
          aria-label={t('serverUpdateTitle')}
          className="animate-in fade-in slide-in-from-bottom-2 w-88 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl duration-200"
        >
          <header className="flex items-start gap-3 border-b bg-gradient-to-br from-primary/15 to-transparent p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-base leading-tight">{t('serverUpdateTitle')}</h2>
              <p className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs tabular-nums">
                {update.currentVersion}
                <ArrowRight className="size-3" aria-hidden="true" />
                <span className="font-medium text-foreground">{update.version}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('serverUpdateLater')}
              className="-m-1 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          {notes.length > 0 && (
            <ul className="max-h-44 list-disc space-y-1 overflow-y-auto py-3 pr-4 pl-8 text-sm">
              {notes.map((note, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: commit subjects can repeat
                <li key={index}>{note}</li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t p-4">
            <p className="text-muted-foreground text-xs">{t('serverUpdateRestartHint')}</p>
            {error && <p className="text-destructive text-xs">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                {t('serverUpdateLater')}
              </Button>
              <Button size="sm" onClick={install} className="gap-2">
                <RotateCw className="size-4" aria-hidden="true" />
                {t('serverUpdateInstall')}
              </Button>
            </div>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group animate-in fade-in slide-in-from-bottom-4 flex h-12 cursor-pointer items-center gap-3 rounded-full border bg-popover pr-5 pl-1.5 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
      >
        <span className="relative flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="size-4" aria-hidden="true" />
          <span className="absolute -top-0.5 -right-0.5 flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-3 rounded-full border-2 border-popover bg-primary" />
          </span>
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="font-medium text-sm">{t('serverUpdateAvailable')}</span>
          <span className="text-muted-foreground text-xs tabular-nums">v{update.version}</span>
        </span>
      </button>
    </div>
  );
}

/** Blocks the page while the server restarts, then reloads it with the new web. */
function InstallingScreen({ version }: { version: string }) {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > SLOW_INSTALL_MS) setSlow(true);
      try {
        const status = await api.get<ServerUpdateStatus>(API.updates.status);
        if (status.currentVersion === version) window.location.reload();
      } catch {
        // The server is down while it installs: keep waiting
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [version]);

  return (
    <div
      role="alertdialog"
      aria-busy="true"
      aria-label={t('serverUpdateInstalling')}
      className="animate-in fade-in fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md duration-300"
    >
      <div className="flex w-80 flex-col items-center gap-4 rounded-2xl border bg-popover p-8 text-center shadow-2xl">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Loader2 className="size-7 animate-spin" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 className="font-semibold text-lg">{t('serverUpdateInstalling')}</h2>
          <p className="text-muted-foreground text-sm tabular-nums">v{version}</p>
        </div>
        <p className="text-muted-foreground text-sm">
          {slow ? t('serverUpdateSlow') : t('serverUpdateReloadHint')}
        </p>
        {slow && (
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            {t('serverUpdateReload')}
          </Button>
        )}
      </div>
    </div>
  );
}

export default ServerUpdateButton;
