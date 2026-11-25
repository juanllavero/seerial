import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type MockProcess = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

const spawnMock = jest.fn();

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  spawnSync: jest.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));

jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg', () => ({
  resolveFfmpegPath: jest.fn(() => ({
    packagedPath: '',
    packagedExists: false,
    systemPath: '',
    resolvedPath: '',
  })),
}));

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  downloaderService: {
    getYtDlpPath: jest.fn(() => 'yt-dlp'),
  },
  fileSystemService: {
    getExternalPath: jest.fn((p: string) => `/ext/${p}`),
    createFolder: jest.fn(),
    existsSync: jest.fn(),
    deleteFile: jest.fn(),
    join: jest.fn((...parts: string[]) => parts.join('/')),
  },
  notificationService: {
    broadcast: jest.fn(),
  },
}));

import { DownloaderServiceImpl } from '@/api/v1/shared/infrastructure/adapters/downloader/DownloaderServiceImpl';

const container = jest.requireMock('@/api/v1/shared/infrastructure/adapters/di/container');

type DownloadContentHost = {
  downloadContent: (command: string, args: string[], fileName: string) => Promise<void>;
};

const spyOnDownloadContent = (service: DownloaderServiceImpl) =>
  jest
    .spyOn(service as unknown as DownloadContentHost, 'downloadContent')
    .mockResolvedValue(undefined);

const buildMockProcess = (): MockProcess => {
  const processEmitter = new EventEmitter() as MockProcess;
  processEmitter.stdout = new EventEmitter();
  processEmitter.stderr = new EventEmitter();
  return processEmitter;
};

// Makes the next spawn call emit the given stdout and close with the given exit code.
const mockSpawnResult = (stdout: string, exitCode: number) => {
  spawnMock.mockImplementationOnce(() => {
    const processEmitter = buildMockProcess();
    setImmediate(() => {
      if (stdout) processEmitter.stdout.emit('data', Buffer.from(stdout));
      processEmitter.emit('close', exitCode);
    });
    return processEmitter;
  });
};

describe('DownloaderServiceImpl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    container.fileSystemService.existsSync.mockReturnValue(false);
  });

  it('builds yt-dlp path', () => {
    const service = new DownloaderServiceImpl();
    expect(service.getYtDlpPath()).toContain('yt-dlp');
  });

  it('builds download video command through downloadContent', async () => {
    const service = new DownloaderServiceImpl();
    const spy = spyOnDownloadContent(service);

    await service.downloadVideo('https://example.com/v', 'downloads', 'video-file');

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBe('yt-dlp');
    expect(spy.mock.calls[0][2]).toBe('video-file');

    spy.mockRestore();
  });

  it('builds download audio command and creates folder', async () => {
    const service = new DownloaderServiceImpl();
    const spy = spyOnDownloadContent(service);

    await service.downloadAudio('https://example.com/a', 'music', 'song-file');

    expect(container.fileSystemService.createFolder).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][2]).toBe('song-file');

    spy.mockRestore();
  });

  it('rejects non-http media urls', async () => {
    const service = new DownloaderServiceImpl();
    const spy = spyOnDownloadContent(service);

    await expect(service.downloadVideo('file:///etc/passwd', 'downloads', 'x')).rejects.toThrow(
      'Invalid media URL',
    );
    await expect(service.downloadAudio('javascript:alert(1)', 'music', 'x')).rejects.toThrow(
      'Invalid media URL',
    );
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('does not delete an existing output file before downloading (a failed download keeps it)', async () => {
    const service = new DownloaderServiceImpl();
    container.fileSystemService.existsSync.mockReturnValue(true);
    const contentSpy = spyOnDownloadContent(service);

    await service.downloadVideo('https://example.com/v', 'downloads', 'video-file');
    await service.downloadAudio('https://example.com/a', 'music', 'song-file');

    expect(container.fileSystemService.deleteFile).not.toHaveBeenCalled();
    expect(contentSpy).toHaveBeenCalledTimes(2);

    contentSpy.mockRestore();
  });

  describe('updateYoutubeDownloader', () => {
    const originalFetch = global.fetch;
    let tmp: string;
    let binary: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-'));
      fs.mkdirSync(path.join(tmp, 'resources', 'lib'), { recursive: true });
      binary = path.join(tmp, 'resources', 'lib', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
      fs.writeFileSync(binary, 'old binary');
      container.fileSystemService.getExternalPath.mockImplementation((p: string) => path.join(tmp, p));
      container.fileSystemService.existsSync.mockReturnValue(true);
    });

    afterEach(() => {
      global.fetch = originalFetch;
      container.fileSystemService.getExternalPath.mockImplementation((p: string) => `/ext/${p}`);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const latestRelease = (tag: string) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ tag_name: tag }) }) as unknown as typeof fetch;
    };

    it('replaces an outdated yt-dlp with the latest release', async () => {
      const service = new DownloaderServiceImpl();
      mockSpawnResult('2026.03.17', 0);
      latestRelease('2026.11.20');
      const download = jest
        .spyOn(service as unknown as { downloadBinary: (d: string) => Promise<void> }, 'downloadBinary')
        .mockImplementation(async (destination: string) => {
          fs.writeFileSync(destination, Buffer.alloc(2_000_000, 1));
        });

      await service.updateYoutubeDownloader();

      expect(download).toHaveBeenCalledTimes(1);
      expect(fs.statSync(binary).size).toBe(2_000_000);
      expect(fs.readdirSync(path.dirname(binary))).toHaveLength(1); // no .new / .old left behind
    });

    it('does nothing when yt-dlp is already the latest version', async () => {
      const service = new DownloaderServiceImpl();
      mockSpawnResult('2026.11.20', 0);
      latestRelease('2026.11.20');
      const download = jest.spyOn(
        service as unknown as { downloadBinary: (d: string) => Promise<void> },
        'downloadBinary',
      );

      await service.updateYoutubeDownloader();

      expect(download).not.toHaveBeenCalled();
      expect(fs.readFileSync(binary, 'utf8')).toBe('old binary');
    });

    it('keeps the current yt-dlp (never throws) when the download is not a real binary', async () => {
      const service = new DownloaderServiceImpl();
      mockSpawnResult('2026.03.17', 0);
      latestRelease('2026.11.20');
      jest
        .spyOn(service as unknown as { downloadBinary: (d: string) => Promise<void> }, 'downloadBinary')
        .mockImplementation(async (destination: string) => {
          fs.writeFileSync(destination, '<html>rate limited</html>');
        });

      await expect(service.updateYoutubeDownloader()).resolves.toBeUndefined();

      expect(fs.readFileSync(binary, 'utf8')).toBe('old binary');
      expect(fs.readdirSync(path.dirname(binary))).toHaveLength(1);
    });

    it('keeps the current yt-dlp (never throws) when GitHub cannot be reached', async () => {
      const service = new DownloaderServiceImpl();
      mockSpawnResult('2026.03.17', 0);
      global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

      await expect(service.updateYoutubeDownloader()).resolves.toBeUndefined();
      expect(fs.readFileSync(binary, 'utf8')).toBe('old binary');
    });
  });

  it('does not try to update a yt-dlp that is not installed yet', async () => {
    const service = new DownloaderServiceImpl();
    container.fileSystemService.existsSync.mockReturnValue(false);

    await service.updateYoutubeDownloader();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('does not download the theme again when it already exists', async () => {
    const service = new DownloaderServiceImpl();
    container.fileSystemService.existsSync.mockReturnValue(true);
    const searchSpy = jest.spyOn(service, 'searchVideos');
    const audioSpy = jest.spyOn(service, 'downloadAudio').mockResolvedValue(undefined);

    await service.autoDownloadFirstAudioResult('query', 'element-1', { id: 'lib', name: 'Lib' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(searchSpy).not.toHaveBeenCalled();
    expect(audioSpy).not.toHaveBeenCalled();
  });

  it('auto-downloads first audio result when available', async () => {
    const service = new DownloaderServiceImpl();
    jest.spyOn(service, 'searchVideos').mockResolvedValue([
      {
        id: '1',
        title: 'x',
        url: 'https://example.com/a',
        duration: 10,
        thumbnail: '',
      },
    ]);
    const audioSpy = jest.spyOn(service, 'downloadAudio').mockResolvedValue(undefined);

    await service.autoDownloadFirstAudioResult('query', 'element-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(audioSpy).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.any(String),
      'element-1',
      true,
    );
  });

  it('does nothing when auto-download has no search results', async () => {
    const service = new DownloaderServiceImpl();
    jest.spyOn(service, 'searchVideos').mockResolvedValue([]);
    const audioSpy = jest.spyOn(service, 'downloadAudio').mockResolvedValue(undefined);

    await service.autoDownloadFirstAudioResult('query', 'element-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(audioSpy).not.toHaveBeenCalled();
  });

  it('broadcasts completion and error events from spawned process', async () => {
    const service = new DownloaderServiceImpl();

    const processEmitter = buildMockProcess();

    spawnMock.mockReturnValue(processEmitter);

    // It resolves when the process closes
    const finished = (service as unknown as DownloadContentHost).downloadContent(
      'yt-dlp',
      ['-f', 'best'],
      'media-file',
    );

    processEmitter.stdout.emit('data', Buffer.from('50.0%'));
    processEmitter.stderr.emit('data', Buffer.from('WARNING: test\nERROR: test-error\ninfo line'));
    processEmitter.emit('close', 0);
    processEmitter.emit('close', 1);
    await finished;

    expect(spawnMock).toHaveBeenCalledWith('yt-dlp', ['-f', 'best'], {
      shell: false,
      windowsHide: true,
    });
    expect(container.notificationService.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('DOWNLOAD_PROGRESS'),
    );
    expect(container.notificationService.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('DOWNLOAD_COMPLETE'),
    );
    expect(container.notificationService.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('DOWNLOAD_ERROR'),
    );
  });

  it('returns parsed search results from yt-dlp json output', async () => {
    const service = new DownloaderServiceImpl();
    mockSpawnResult(
      `${JSON.stringify({ id: 'v1', title: 'Video', url: 'https://v', duration: 42, thumbnails: [{ url: 'thumb' }] })}\n`,
      0,
    );

    const result = await service.searchVideos('video query', 3);

    expect(spawnMock).toHaveBeenCalledWith(
      'yt-dlp',
      expect.arrayContaining(['ytsearch3:video query', '--dump-json']),
      { shell: false, windowsHide: true },
    );
    expect(result).toEqual([
      {
        id: 'v1',
        title: 'Video',
        url: 'https://v',
        duration: 42,
        thumbnail: 'thumb',
      },
    ]);
  });

  it('returns empty list for blank queries without spawning yt-dlp', async () => {
    const service = new DownloaderServiceImpl();

    await expect(service.searchVideos('   ', 3)).resolves.toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns empty list when yt-dlp output is empty or execution fails', async () => {
    const service = new DownloaderServiceImpl();

    mockSpawnResult('', 0);
    await expect(service.searchVideos('query', 0)).resolves.toEqual([]);

    mockSpawnResult('', 1);
    await expect(service.searchVideos('query', 1)).resolves.toEqual([]);
  });

  it('handles synchronous spawn failures in downloadContent', async () => {
    const service = new DownloaderServiceImpl();
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    await expect(
      (service as unknown as DownloadContentHost).downloadContent('cmd', [], 'file'),
    ).resolves.toBeUndefined();
  });

  it('covers downloadYoutubeDownloader early return and error branches in isolated module', async () => {
    const httpsGet = jest.fn();
    const existsSyncMock = jest.fn().mockReturnValue(true);

    jest.resetModules();
    jest.doMock('node:child_process', () => ({
      spawn: jest.fn(),
      spawnSync: jest.fn(() => ({ status: 1, stdout: '', stderr: '' })),
    }));
    jest.doMock('@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg', () => ({
      resolveFfmpegPath: jest.fn(() => ({
        packagedPath: '',
        packagedExists: false,
        systemPath: '',
        resolvedPath: '',
      })),
    }));
    jest.doMock('follow-redirects', () => ({
      https: { get: httpsGet },
    }));
    jest.doMock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
      downloaderService: { getYtDlpPath: jest.fn(() => 'yt-dlp') },
      fileSystemService: {
        getExternalPath: jest.fn((p: string) => `/ext/${p}`),
        createFolder: jest.fn(),
        existsSync: existsSyncMock,
        deleteFile: jest.fn(),
        chmod: jest.fn(),
        createWriteStream: jest.fn(() => {
          const emitter = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
          emitter.destroy = jest.fn();
          return emitter;
        }),
        join: jest.fn((...parts: string[]) => parts.join('/')),
      },
      notificationService: { broadcast: jest.fn() },
    }));

    const isolated = jest.requireActual(
      '@/api/v1/shared/infrastructure/adapters/downloader/DownloaderServiceImpl',
    ) as { DownloaderServiceImpl: typeof DownloaderServiceImpl };
    const service = new isolated.DownloaderServiceImpl();

    await expect(service.downloadYoutubeDownloader()).resolves.toBeUndefined();
    expect(httpsGet).not.toHaveBeenCalled();

    existsSyncMock.mockReturnValue(false);
    httpsGet.mockImplementation(
      (_url: string, cb: (res: { statusCode: number; pipe: (f: unknown) => void }) => void) => {
        cb({ statusCode: 500, pipe: () => undefined });
        return { on: jest.fn().mockReturnThis() };
      },
    );

    await expect(service.downloadYoutubeDownloader()).rejects.toThrow('Error downloading yt-dlp');
  });
});
