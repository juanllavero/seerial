import { EventEmitter } from 'node:events';

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

jest.mock('@/api/v1/shared/infrastructure/services/artwork/themeMedia', () => ({
  themeMediaSlot: jest.fn(async () => ({ folder: '/content', name: 'theme' })),
  findThemeMedia: jest.fn(async () => null),
  findInSlot: jest.fn(() => '/content/theme.opus'),
  temporaryStem: jest.fn(() => '/content/.theme-abc.tmp'),
  commitThemeMedia: jest.fn(),
  removeTemporaryFiles: jest.fn(),
}));

import { DownloaderServiceImpl } from '@/api/v1/shared/infrastructure/adapters/downloader/DownloaderServiceImpl';

const container = jest.requireMock('@/api/v1/shared/infrastructure/adapters/di/container');
const themeMedia = jest.requireMock('@/api/v1/shared/infrastructure/services/artwork/themeMedia');

type DownloadContentHost = {
  downloadContent: (
    command: string,
    args: string[],
    fileName: string,
    settle: (succeeded: boolean) => boolean,
  ) => Promise<void>;
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

  const slot = { folder: '/content', name: 'theme' };
  const options = { overwrite: true, name: 'element' };

  it('downloads to a temporary file in the folder of the content', async () => {
    const service = new DownloaderServiceImpl();
    const spy = spyOnDownloadContent(service);

    await service.downloadThemeMedia('https://example.com/a', 'theme', slot, options);

    expect(container.fileSystemService.createFolder).toHaveBeenCalledWith('/content');
    const args = spy.mock.calls[0][1];
    expect(args[args.indexOf('-o') + 1]).toMatch(/\.theme-\w+\.tmp\.opus$/);
    expect(spy.mock.calls[0][2]).toBe('element');
    expect(container.fileSystemService.deleteFile).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('rejects non-http media urls', async () => {
    const service = new DownloaderServiceImpl();
    const spy = spyOnDownloadContent(service);

    await expect(
      service.downloadThemeMedia('file:///etc/passwd', 'video', slot, options),
    ).rejects.toThrow('Invalid media URL');
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('does not try to update a yt-dlp that is not installed yet', async () => {
    const service = new DownloaderServiceImpl();
    container.fileSystemService.existsSync.mockReturnValue(false);

    await service.updateYoutubeDownloader();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  const movie = { id: 'element-1', folder: '/content' };
  const search = (service: DownloaderServiceImpl, results = 1) =>
    jest
      .spyOn(service, 'searchVideos')
      .mockResolvedValue(
        [{ id: '1', title: 'x', url: 'https://example.com/a', duration: 10, thumbnail: '' }].slice(
          0,
          results,
        ),
      );

  it('does not download a theme when the content already has one', async () => {
    const service = new DownloaderServiceImpl();
    themeMedia.findThemeMedia.mockResolvedValueOnce('/content/theme.mp3');
    const searchSpy = search(service);

    await service.autoDownloadFirstAudioResult('query', 'movie', movie);

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('auto-downloads the first audio result without replacing files', async () => {
    const service = new DownloaderServiceImpl();
    search(service);
    const download = jest.spyOn(service, 'downloadThemeMedia').mockResolvedValue(undefined);

    await service.autoDownloadFirstAudioResult('query', 'movie', movie);
    await new Promise((resolve) => setImmediate(resolve));

    expect(download).toHaveBeenCalledWith('https://example.com/a', 'theme', slot, {
      overwrite: false,
      name: 'element-1',
      waitForCompletion: true,
    });
  });

  it('does nothing when auto-download has no search results', async () => {
    const service = new DownloaderServiceImpl();
    search(service, 0);
    const download = jest.spyOn(service, 'downloadThemeMedia').mockResolvedValue(undefined);

    await service.autoDownloadFirstAudioResult('query', 'movie', { ...movie, id: 'element-2' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(download).not.toHaveBeenCalled();
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
      (succeeded) => succeeded,
    );

    processEmitter.stdout.emit('data', Buffer.from('50.0%'));
    processEmitter.stderr.emit('data', Buffer.from('WARNING: test\nERROR: test-error\ninfo line'));
    processEmitter.emit('close', 0);
    processEmitter.emit('close', 1);
    await finished;

    expect(spawnMock).toHaveBeenCalledWith('yt-dlp', ['-f', 'best'], expect.objectContaining({
      shell: false,
      windowsHide: true,
      env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
    }));
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
      expect.objectContaining({ shell: false, windowsHide: true, env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }) }),
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
      (service as unknown as DownloadContentHost).downloadContent('cmd', [], 'file', (succeeded) => succeeded),
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
