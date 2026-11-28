import type { ArtworkEntity } from '@/api/v1/shared/infrastructure/services/artwork/ArtworkService';
import type { ArtworkSlot } from '@/api/v1/shared/infrastructure/services/artwork/artworkFiles';
import {
  commitThemeMedia,
  findInSlot,
  findThemeMedia,
  removeTemporaryFiles,
  temporaryStem,
  type ThemeKind,
  type ThemeOwner,
  themeMediaSlot,
} from '@/api/v1/shared/infrastructure/services/artwork/themeMedia';
import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { https } from 'follow-redirects';
import {
  downloaderService,
  fileSystemService,
  notificationService,
} from '@/api/v1/shared/infrastructure/adapters/di/container';
import { resolveFfmpegPath } from '@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg';
import { scanActivity } from '@/api/v1/shared/infrastructure/services/ScanActivityTracker';
import { WriteQueue } from '@/api/v1/shared/infrastructure/services/WriteQueue';
import type { MediaSearchResult } from '@/data/interfaces/SearchResults';
import logger from '@/utils/logger';
import type { DownloaderServicePort } from '../../../application/ports/DownloaderServicePort';

const downloaderLogger = logger.child({ category: 'Downloader' });

const {
  packagedPath: ffmpegPathFinal,
  packagedExists: ffmpegStaticExists,
  systemPath: systemFfmpegPath,
  resolvedPath: ffmpegLocation,
} = resolveFfmpegPath();

// yt-dlp needs a JavaScript runtime for YouTube. Always use the one running this server: plain
// node in development, or the Electron binary in the packaged app, which behaves as node when
// ELECTRON_RUN_AS_NODE is set (the yt-dlp children inherit it). No global node install is needed.
const YT_DLP_JS_RUNTIME_ARGS = ['--js-runtimes', `node:${process.execPath}`];
const YT_DLP_ENV: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

if (!ffmpegStaticExists && ffmpegPathFinal && systemFfmpegPath) {
  downloaderLogger.info(
    { ffmpegPathFinal, systemFfmpegPath },
    'ffmpeg-static path does not exist. Using system ffmpeg for yt-dlp',
  );
}

if (!ffmpegStaticExists && ffmpegPathFinal && !systemFfmpegPath) {
  downloaderLogger.warn(
    { ffmpegPathFinal },
    'ffmpeg-static path does not exist and system ffmpeg was not found. Continuing without explicit ffmpeg location',
  );
}

// Singleton queue: all auto-downloads are serialized so only one yt-dlp search+download
// runs at a time, preventing unbounded memory usage during library scans.
const autoDownloadQueue = new WriteQueue();

// Themes whose download failed (no results, YouTube refusing...) are not tried again until the
// server restarts, so the periodic scans do not repeat the same failing downloads over and over.
const failedThemeDownloads = new Set<string>();

const MAX_SEARCH_QUERY_LENGTH = 300;

const YT_DLP_UPDATE_TIMEOUT_MS = 180_000;

// A real yt-dlp binary is ~18 MB: anything tiny is an error page or a cut download
const MIN_YT_DLP_SIZE_BYTES = 1_000_000;

function normalizeSearchQuery(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
}

function isSafeMediaUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function runProcessCaptureStdout(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: YT_DLP_ENV,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          `Process exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });
}

interface ThemeDownloadOptions {
  overwrite: boolean;
  /** Sent to the clients when the download ends */
  name: string;
  waitForCompletion?: boolean;
}

export class DownloaderServiceImpl implements DownloaderServicePort {
  private getBinDir = (): string => {
    return fileSystemService.getExternalPath(path.join('resources', 'lib'));
  };

  getYtDlpPath = (): string => {
    const binDir = fileSystemService.getExternalPath(path.join('resources', 'lib'));
    return path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  };

  private getDownloadURL(): string {
    if (process.platform === 'win32')
      return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    if (process.platform === 'darwin')
      return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
    return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  }

  /**
   * Force re-downloads yt-dlp, deleting the existing binary first.
   * Used to recover from a corrupt or outdated binary (e.g. missing DLL on Windows).
   */
  private async forceReDownloadYtDlp(): Promise<void> {
    const ytDlpPath = this.getYtDlpPath();
    try {
      if (fileSystemService.existsSync(ytDlpPath)) fileSystemService.deleteFile(ytDlpPath);
    } catch (err) {
      downloaderLogger.warn({ err }, 'Could not delete existing yt-dlp binary before re-download');
    }
    await this.downloadYoutubeDownloader();
  }

  /**
   * Updates yt-dlp to the latest GitHub release. YouTube changes often and an old binary ends up
   * refused (HTTP 403), which breaks every download. It never throws: with no connection, or if
   * anything fails, the current binary is kept.
   *
   * It does not use `yt-dlp -U`: that refuses to update builds it considers "unofficial" (which
   * is what the downloaded binary was reported as). The new release is downloaded next to the old
   * one and swapped in only when complete, so a failed update never leaves the server without it.
   */
  async updateYoutubeDownloader(timeoutMs = YT_DLP_UPDATE_TIMEOUT_MS): Promise<void> {
    const ytDlpPath = this.getYtDlpPath();
    if (!fileSystemService.existsSync(ytDlpPath)) return;

    try {
      await Promise.race([
        this.updateToLatestRelease(ytDlpPath),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('yt-dlp update timed out')), timeoutMs).unref?.(),
        ),
      ]);
    } catch (error) {
      downloaderLogger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Could not update yt-dlp, keeping the current version',
      );
    }
  }

  private async updateToLatestRelease(ytDlpPath: string): Promise<void> {
    const [current, latest] = await Promise.all([
      runProcessCaptureStdout(ytDlpPath, ['--version']).then((v) => v.trim()),
      this.getLatestYtDlpVersion(),
    ]);

    // Versions are dates (2026.03.17, nightlies add a time), so they compare as text
    if (current >= latest) {
      downloaderLogger.info({ current, latest }, 'yt-dlp is up to date');
      return;
    }

    downloaderLogger.info({ current, latest }, 'Updating yt-dlp');
    const downloaded = `${ytDlpPath}.new`;
    await this.downloadBinary(downloaded);

    const size = (await fsPromises.stat(downloaded)).size;
    if (size < MIN_YT_DLP_SIZE_BYTES) {
      await fsPromises.rm(downloaded, { force: true });
      throw new Error(`Downloaded yt-dlp is too small (${size} bytes)`);
    }
    if (process.platform !== 'win32') await fsPromises.chmod(downloaded, 0o755);

    // A running executable cannot be overwritten on Windows, but it can be renamed
    const previous = `${ytDlpPath}.old`;
    await fsPromises.rm(previous, { force: true }).catch(() => {});
    await fsPromises.rename(ytDlpPath, previous);
    try {
      await fsPromises.rename(downloaded, ytDlpPath);
    } catch (error) {
      await fsPromises.rename(previous, ytDlpPath); // Put the working one back
      throw error;
    }
    await fsPromises.rm(previous, { force: true }).catch(() => {});

    downloaderLogger.info({ from: current, to: latest }, 'yt-dlp updated');
  }

  private async getLatestYtDlpVersion(): Promise<string> {
    const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'seerial-media-server' },
    });
    if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`);

    const tag = ((await response.json()) as { tag_name?: string }).tag_name;
    if (!tag) throw new Error('GitHub did not report the latest yt-dlp version');
    return tag;
  }

  /** Downloads the yt-dlp release for this platform (following redirects) to `destination`. */
  private downloadBinary(destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fileSystemService.createWriteStream(destination);
      const fail = (error: Error) => {
        file.destroy();
        fsPromises.rm(destination, { force: true }).catch(() => {});
        reject(error);
      };

      https
        .get(this.getDownloadURL(), (response) => {
          if (response.statusCode !== 200) {
            fail(new Error(`Error downloading yt-dlp. HTTP code ${response.statusCode}`));
            return;
          }
          response.pipe(file);
          file.on('finish', () => resolve());
          file.on('error', fail);
        })
        .on('error', fail);
    });
  }

  /**
   * Downloads yt-dlp and assigns execution permissions on macOS/Linux
   */
  async downloadYoutubeDownloader(): Promise<void> {
    const binDir = this.getBinDir();
    const ytDlpPath = this.getYtDlpPath();

    if (fileSystemService.existsSync(ytDlpPath)) {
      downloaderLogger.info({ message: 'yt-dlp is already in:', ytDlpPath });
      return;
    }

    fileSystemService.createFolder(binDir);

    const url = this.getDownloadURL();

    downloaderLogger.info({ message: 'Downloading yt-dlp from:', url });

    return new Promise((resolve, reject) => {
      const file = fileSystemService.createWriteStream(ytDlpPath);

      https
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            file.destroy();
            if (fileSystemService.existsSync(ytDlpPath)) {
              fileSystemService.deleteFile(ytDlpPath);
            }
            reject(
              new Error(`[DepCheck]: Error downloading yt-dlp. HTTP code ${response.statusCode}`),
            );
            return;
          }

          response.pipe(file);

          file.on('finish', () => {
            try {
              if (process.platform !== 'win32') {
                fileSystemService.chmod(ytDlpPath, 0o755); // Add executable permission
              }
              resolve();
            } catch (err) {
              reject(err);
            }
          });

          file.on('error', (err) => {
            if (fileSystemService.existsSync(ytDlpPath)) {
              fileSystemService.deleteFile(ytDlpPath);
            }
            reject(err);
          });
        })
        .on('error', (err) => {
          // Clean partially downloaded file
          try {
            if (fileSystemService.existsSync(ytDlpPath)) fileSystemService.deleteFile(ytDlpPath);
          } catch { }
          reject(err);
        });
    });
  }

  public async searchVideos(query: string, numberOfResults: number): Promise<MediaSearchResult[]> {
    const safeQuery = normalizeSearchQuery(query);
    if (!safeQuery) {
      return [];
    }

    const ytDlpPath = downloaderService.getYtDlpPath();
    const searchArgs = [
      `ytsearch${numberOfResults > 0 ? numberOfResults : 1}:${safeQuery}`,
      '--dump-json',
      '--default-search',
      'ytsearch',
      '--no-playlist',
      '--no-check-certificate',
      '--geo-bypass',
      '--flat-playlist',
      '--skip-download',
      '--quiet',
      '--ignore-errors',
    ];

    if (ffmpegLocation) {
      searchArgs.push('--ffmpeg-location', ffmpegLocation);
    }

    searchArgs.push(...YT_DLP_JS_RUNTIME_ARGS);

    try {
      const stdout = await runProcessCaptureStdout(ytDlpPath, searchArgs);

      if (!stdout) return [];

      // JSON parse
      const entries = stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      // biome-ignore lint/suspicious/noExplicitAny: <External data>
      return entries.map((entry: any) => ({
        id: entry.id,
        title: entry.title,
        url: entry.url,
        duration: entry.duration,
        thumbnail: entry.thumbnails && entry.thumbnails.length > 0 ? entry.thumbnails[0].url : '',
      }));
    } catch (error: unknown) {
      // Windows STATUS_DLL_NOT_FOUND (0xC0000135): binary is corrupt or missing a runtime.
      // Re-download yt-dlp and retry once.
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException & { code?: number }).code === 3221225773
      ) {
        downloaderLogger.warn(
          { code: (error as NodeJS.ErrnoException & { code?: number }).code },
          'yt-dlp binary failed with DLL_NOT_FOUND — re-downloading and retrying',
        );
        try {
          await this.forceReDownloadYtDlp();
          const retryStdout = await runProcessCaptureStdout(ytDlpPath, searchArgs);
          if (!retryStdout) return [];
          const retryEntries = retryStdout
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line));
          // biome-ignore lint/suspicious/noExplicitAny: <External data>
          return retryEntries.map((entry: any) => ({
            id: entry.id,
            title: entry.title,
            url: entry.url,
            duration: entry.duration,
            thumbnail:
              entry.thumbnails && entry.thumbnails.length > 0 ? entry.thumbnails[0].url : '',
          }));
        } catch (retryError) {
          downloaderLogger.error(retryError, 'Error executing yt-dlp after re-download');
          return [];
        }
      }
      downloaderLogger.error(error, 'Error executing yt-dlp');
      return [];
    }
  }

  /**
   * Downloads a theme song or background video into its place. It is downloaded to a temporary file
   * first, so a failed download does not lose the previous one. Without `overwrite` an existing
   * file always wins. Runs in the background unless `waitForCompletion` is set.
   */
  public async downloadThemeMedia(
    url: string,
    kind: ThemeKind,
    slot: ArtworkSlot,
    { overwrite, name, waitForCompletion = false }: ThemeDownloadOptions,
  ): Promise<void> {
    if (!isSafeMediaUrl(url)) {
      throw new Error('Invalid media URL');
    }

    fileSystemService.createFolder(slot.folder);

    const stem = temporaryStem(slot);
    const [format, extension] =
      kind === 'theme' ? ['bestaudio/best', 'opus'] : ['bestvideo*+bestaudio/best', 'webm'];

    const command = downloaderService.getYtDlpPath();
    const args = ['-f', format, '-o', `${stem}.${extension}`, url, '-q', '--progress'];

    if (ffmpegLocation) {
      args.push('--ffmpeg-location', ffmpegLocation);
    }

    args.push(...YT_DLP_JS_RUNTIME_ARGS);

    const finished = this.downloadContent(command, args, name, (succeeded) => {
      if (succeeded) return commitThemeMedia(slot, kind, stem, { overwrite }) !== null;
      removeTemporaryFiles(stem);
      return false;
    });
    if (waitForCompletion) await finished;
  }

  private downloadContent(
    command: string,
    args: string[],
    fileName: string,
    settle: (succeeded: boolean) => boolean,
  ): Promise<void> {
    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });

    try {
      const process = spawn(command, args, {
        shell: false,
        windowsHide: true,
        env: YT_DLP_ENV,
      });

      process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();

        // Parse progress percentage from yt-dlp output
        const match = output.match(/(\d+(\.\d+)?)%/);
        if (match) {
          const progress = parseFloat(match[1]);

          // Generate message for WebSockets
          const message = {
            header: 'DOWNLOAD_PROGRESS',
            body: String(progress),
          };

          // Send progress to the client
          notificationService.broadcast(JSON.stringify(message));
        }
      });

      process.stderr.on('data', (data: Buffer) => {
        const stderrOutput = data.toString();
        const stderrLines = stderrOutput
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        for (const line of stderrLines) {
          if (line.startsWith('WARNING:')) {
            downloaderLogger.warn({ stderr: line }, 'Download stderr');
            continue;
          }

          if (line.startsWith('ERROR:')) {
            downloaderLogger.error({ stderr: line }, 'Download stderr');
            continue;
          }

          downloaderLogger.info({ stderr: line }, 'Download stderr');
        }
      });

      process.on('error', (error) => {
        downloaderLogger.error(error, 'yt-dlp could not be started');
        finish();
      });

      process.on('close', (code: number) => {
        // The file is in its place before the clients are told
        let saved = false;
        try {
          saved = settle(code === 0);
        } catch (error) {
          downloaderLogger.error(error, 'The downloaded file could not be saved');
        }
        finish();
        if (saved) {
          // Generate message for WebSockets
          const message = {
            header: 'DOWNLOAD_COMPLETE',
            body: fileName,
          };

          // Send complete message to the client
          notificationService.broadcast(JSON.stringify(message));
        } else {
          // Generate message for WebSockets
          const message = {
            header: 'DOWNLOAD_ERROR',
            body: code,
          };

          // Send error message to the client
          notificationService.broadcast(JSON.stringify(message));
        }
      });
    } catch (error) {
      downloaderLogger.error(error, 'Error executing yt-dlp');
      finish();
    }

    return finished;
  }

  public async autoDownloadFirstAudioResult(
    query: string,
    owner: ThemeOwner,
    entity: ArtworkEntity,
    library?: { id: string; name: string },
  ): Promise<void> {
    const elementId = entity.id;
    try {
      // The themes the content already has are kept: scans run often, and what the user has in
      // local is never replaced
      const slot = await themeMediaSlot(owner, entity, 'theme');
      if (!slot || failedThemeDownloads.has(elementId)) return;
      if (await findThemeMedia(owner, entity, 'theme')) return;
      // Downloaded by a previous version and not moved yet
      const previous = fileSystemService.join('resources', 'music', elementId, `${elementId}.opus`);
      if (fileSystemService.existsSync(fileSystemService.getExternalPath(previous))) return;

      if (library) scanActivity.musicQueued(library.id, library.name);

      // Enqueue so downloads run sequentially in the background, avoiding
      // spawning a yt-dlp process per item during large scans.
      autoDownloadQueue
        .enqueue(async () => {
          const [video] = await this.searchVideos(query, 1);

          if (!video) {
            downloaderLogger.warn({ query }, 'No results found for auto-download');
            failedThemeDownloads.add(elementId);
            return;
          }

          await this.downloadThemeMedia(video.url, 'theme', slot, {
            overwrite: false,
            name: elementId,
            waitForCompletion: true,
          });
          if (!findInSlot(slot, 'theme')) failedThemeDownloads.add(elementId);
        })
        .catch((error) => downloaderLogger.error({ error, query }, 'Auto-download failed'))
        .finally(() => {
          if (library) scanActivity.musicSettled(library.id);
        });
      // The caller (scan use-case) does not need to wait for the download
    } catch (error) {
      downloaderLogger.error({ error, query }, 'Auto-download failed');
    }
  }
}
