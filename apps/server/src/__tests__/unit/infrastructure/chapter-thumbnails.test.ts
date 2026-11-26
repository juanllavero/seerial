const mockExecuteFfmpeg = jest.fn();
const mockExistingFiles = new Set<string>();

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  fileSystemService: {
    getExternalPath: (relativePath: string) => `/data/${relativePath}`,
    existsSync: (filePath: string) => mockExistingFiles.has(filePath.replace(/\\/g, '/')),
    createFolder: jest.fn(),
  },
}));

jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg', () => ({
  executeFfmpeg: (...args: unknown[]) => mockExecuteFfmpeg(...args),
  executeFfmpegPipeToStream: jest.fn(),
}));

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { child: () => ({ error: jest.fn() }) },
}));

import { VideoExtractionServiceImpl } from '@/api/v1/videos/infrastructure/services/VideoExtractionServiceImpl';

const chapters = [0, 60].map((time) => ({ title: '', time, displayTime: '', thumbnailSrc: '' }));

/** Pretends ffmpeg wrote the image it was asked for (its last argument). */
const writeOutput = async (args: string[]) => {
  mockExistingFiles.add(args[args.length - 1].replace(/\\/g, '/'));
};

describe('chapter thumbnails', () => {
  const service = new VideoExtractionServiceImpl();

  beforeEach(() => {
    mockExistingFiles.clear();
    mockExecuteFfmpeg.mockReset().mockImplementation(writeOutput);
  });

  it('decodes only keyframes at low priority and returns paths with forward slashes', async () => {
    const result = await service.generateChapterThumbnails('v1', '/movie.mkv', chapters);

    expect(result.map((chapter) => chapter.thumbnailSrc)).toEqual([
      'resources/img/thumbnails/chapters/v1/chapter_0.jpg',
      'resources/img/thumbnails/chapters/v1/chapter_1.jpg',
    ]);
    expect(mockExecuteFfmpeg).toHaveBeenCalledTimes(2);
    expect(mockExecuteFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining(['-skip_frame', 'nokey', '-ss', '61']),
      { lowPriority: true },
    );
  });

  it('generates only the missing thumbnails', async () => {
    mockExistingFiles.add('/data/resources/img/thumbnails/chapters/v1/chapter_0.jpg');

    await service.generateChapterThumbnails('v1', '/movie.mkv', chapters);

    expect(mockExecuteFfmpeg).toHaveBeenCalledTimes(1);
  });

  it('shares the work between simultaneous requests', async () => {
    await Promise.all([
      service.generateChapterThumbnails('v1', '/movie.mkv', chapters),
      service.generateChapterThumbnails('v1', '/movie.mkv', chapters),
    ]);

    expect(mockExecuteFfmpeg).toHaveBeenCalledTimes(2);
  });

  it('takes the exact frame when no keyframe follows the chapter start', async () => {
    mockExecuteFfmpeg.mockImplementation(async (args: string[]) => {
      if (!args.includes('-skip_frame')) await writeOutput(args);
    });

    const result = await service.generateChapterThumbnails('v1', '/movie.mkv', [chapters[1]]);

    expect(mockExecuteFfmpeg).toHaveBeenCalledTimes(2);
    expect(result[0].thumbnailSrc).not.toBe('');
  });

  it('leaves the thumbnail empty when ffmpeg fails', async () => {
    mockExecuteFfmpeg.mockRejectedValue(new Error('ffmpeg failed'));

    const result = await service.generateChapterThumbnails('v1', '/movie.mkv', chapters);

    expect(result.map((chapter) => chapter.thumbnailSrc)).toEqual(['', '']);
  });
});
