import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppUpdater } from '../hooks/use-app-updater';

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Startup screen: checks for a new version and, if there is one, downloads and installs it
 * (progress bar) and restarts the app. The app itself is only shown once that is done.
 */
function UpdateGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const updater = useAppUpdater();
  const { phase, currentVersion, newVersion, downloaded, total, error } = updater;

  if (phase === 'done') return <>{children}</>;

  const percent = total ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
  const message = {
    checking: t('updaterChecking'),
    downloading: t('updaterDownloading'),
    installing: t('updaterInstalling'),
    restarting: t('updaterRestarting'),
    error: t('updaterError'),
  }[phase];
  // While checking, stay discreet: usually there is nothing to update and it takes a moment
  const discreet = phase === 'checking';

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-black text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 45%, color-mix(in srgb, var(--app-color) 22%, transparent), transparent)',
        }}
      />

      <div className="relative flex w-[min(42vw,36rem)] flex-col items-center gap-[3.5vh]">
        <img
          src="/Seerial_logo.svg"
          alt="Seerial"
          className={`h-[7vh] transition-opacity duration-500 ${discreet ? 'opacity-60' : 'opacity-100'}`}
        />

        {!discreet && newVersion && (
          <p className="text-[1.8vh] text-white/60 tabular-nums">
            {currentVersion ? `${currentVersion}  →  ` : ''}
            <span className="font-semibold text-white">{newVersion}</span>
          </p>
        )}

        <div className="flex w-full flex-col gap-[1.4vh]">
          <div className="flex items-baseline justify-between text-[2vh]">
            <span className={discreet ? 'text-white/50' : 'text-white'}>{message}</span>
            {phase === 'downloading' && (
              <span className="text-[1.7vh] text-white/60 tabular-nums">
                {percent === null
                  ? `${formatMB(downloaded)} MB`
                  : `${percent}%  ·  ${formatMB(downloaded)} / ${formatMB(total ?? 0)} MB`}
              </span>
            )}
          </div>

          {phase !== 'error' && (
            <div className="h-[0.7vh] w-full overflow-hidden rounded-full bg-white/10">
              {phase === 'downloading' && percent !== null ? (
                <div
                  className="h-full rounded-full bg-[var(--app-color)] transition-[width] duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              ) : (
                // Unknown duration: checking, installing, restarting
                <div className="h-full w-1/3 animate-[updater-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-[var(--app-color)]" />
              )}
            </div>
          )}

          {phase === 'error' && (
            <>
              <p className="text-[1.6vh] text-white/50">{error}</p>
              <div className="mt-[2vh] flex justify-center gap-[1.5vw]">
                <button
                  type="button"
                  // biome-ignore lint/a11y/noAutofocus: only control on screen, used with a remote
                  autoFocus
                  onClick={updater.retry}
                  className="rounded-full bg-white px-[2vw] py-[1.2vh] font-semibold text-[1.8vh] text-black outline-none transition-transform focus:scale-105 focus:ring-4 focus:ring-[var(--app-color)]"
                >
                  {t('updaterRetry')}
                </button>
                <button
                  type="button"
                  onClick={updater.skip}
                  className="rounded-full bg-white/10 px-[2vw] py-[1.2vh] text-[1.8vh] text-white outline-none transition-transform focus:scale-105 focus:ring-4 focus:ring-[var(--app-color)]"
                >
                  {t('updaterSkip')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes updater-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}

export default UpdateGate;
