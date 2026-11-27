import fs from 'node:fs';
import path from 'node:path';
import { MessageType, type ServerUpdateStatus } from '@seerial/domain';
import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { notificationService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import logger from '@/utils/logger';
import type { AppUpdaterPort } from '../../application/ports/AppUpdaterPort';
import {
  currentAppBundle,
  downloadVerified,
  extractApp,
  scheduleReplaceAndRelaunch,
} from './macAppReplacer';

const updaterLogger = logger.child({ category: 'App Updater' });

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Same feed as build.publish in package.json (the release workflow updates it). */
const FEED_URL = 'https://github.com/juanllavero/seerial/releases/download/server-channel';

function notesOf(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes;
  if (!notes) return undefined;
  if (typeof notes === 'string') return notes.trim();
  return notes
    .map((n) => n.note ?? '')
    .join('\n')
    .trim();
}

/**
 * Windows (NSIS) and Linux (AppImage): electron-updater checks, downloads and installs.
 * macOS: electron-updater only checks; the zip is downloaded and swapped in by macAppReplacer
 * because Squirrel.Mac rejects apps without an Apple Developer ID signature.
 */
export class AppUpdaterService implements AppUpdaterPort {
  private status: ServerUpdateStatus = {
    state: 'unsupported',
    currentVersion: process.env.SEERIAL_VERSION || app.getVersion(),
  };
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  /** macOS: the extracted new .app waiting to be installed. */
  private pendingMacApp: string | null = null;
  private readonly isMac = process.platform === 'darwin';
  private readonly workDir = path.join(app.getPath('userData'), 'updates');

  start(): void {
    if (!app.isPackaged || this.timer) return;
    // AppImage updates need the path of the running AppImage
    if (process.platform === 'linux' && !process.env.APPIMAGE) return;

    autoUpdater.logger = updaterLogger;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL });

    autoUpdater.on('download-progress', (p) =>
      this.setStatus({ state: 'downloading', progress: Math.floor(p.percent) }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.setStatus({
        state: 'ready',
        version: info.version,
        notes: notesOf(info),
        progress: 100,
      }),
    );
    autoUpdater.on('error', (error) => this.fail(error));

    this.setStatus({ state: 'idle' });
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  getStatus(): ServerUpdateStatus {
    return this.status;
  }

  async install(): Promise<void> {
    if (this.status.state !== 'ready') throw new Error('No update ready to install');
    this.setStatus({ state: 'installing' });
    updaterLogger.info({ version: this.status.version }, 'Installing update and restarting');

    // Let the response and the websocket message leave before closing
    setTimeout(() => {
      if (this.isMac && this.pendingMacApp) {
        scheduleReplaceAndRelaunch(this.pendingMacApp, currentAppBundle(), this.workDir);
        app.quit();
      } else {
        // Silent install, then start the server again
        autoUpdater.quitAndInstall(true, true);
      }
    }, 500);
  }

  private async check(): Promise<void> {
    // Once downloaded, keep offering that version until it is installed
    if (this.checking || ['downloading', 'ready', 'installing'].includes(this.status.state)) return;
    this.checking = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        this.setStatus({
          state: 'idle',
          version: undefined,
          notes: undefined,
          progress: undefined,
        });
        return;
      }
      const info = result.updateInfo;
      this.setStatus({
        state: 'downloading',
        version: info.version,
        notes: notesOf(info),
        progress: 0,
      });
      if (this.isMac) await this.downloadMac(info);
      else await autoUpdater.downloadUpdate();
    } catch (error) {
      this.fail(error);
    } finally {
      this.checking = false;
    }
  }

  private async downloadMac(info: UpdateInfo): Promise<void> {
    const zip = info.files.find((f) => f.url.endsWith('.zip'));
    if (!zip) throw new Error('The update has no macOS zip');
    const url = new URL(zip.url, `${FEED_URL}/`).toString();

    fs.rmSync(this.workDir, { recursive: true, force: true });
    const zipPath = path.join(this.workDir, 'update.zip');
    await downloadVerified(url, zip.sha512, zipPath, (progress) =>
      this.setStatus({ state: 'downloading', progress }),
    );
    this.pendingMacApp = await extractApp(zipPath, this.workDir);
    fs.rmSync(zipPath, { force: true });
    this.setStatus({ state: 'ready', progress: 100 });
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    updaterLogger.warn({ error: message }, 'Update failed');
    // Offline or GitHub unreachable: try again on the next check
    this.setStatus({ state: 'error', error: message });
  }

  private setStatus(patch: Partial<ServerUpdateStatus>): void {
    const next = { ...this.status, ...patch };
    if (patch.state && patch.state !== 'error') next.error = undefined;
    // Download progress is reported often: only broadcast real changes
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    notificationService.broadcast(
      JSON.stringify({ header: MessageType.SERVER_UPDATE, body: next }),
    );
  }
}

export const appUpdaterService = new AppUpdaterService();
