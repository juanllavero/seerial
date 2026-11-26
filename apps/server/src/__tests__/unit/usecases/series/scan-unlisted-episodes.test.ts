import { ScanSeriesUseCase } from '@/api/v1/series/application/usecases/ScanSeriesUseCase';
import { matchSpecialEpisode } from '@/api/v1/series/application/utils/matchSpecialEpisode';

const generateVideoThumbnail = jest.fn(
  async (id: string) => `resources/img/thumbnails/video/${id}/frame.jpg`,
);
const runtimes: Record<string, number> = {};

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  downloaderService: {},
  videoExtractionService: {
    generateVideoThumbnail: (...args: [string]) => generateVideoThumbnail(...args),
  },
}));
jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/mediaInfo', () => ({
  getMediaInfo: jest.fn(),
  getOnlyRuntime: jest.fn(async (file: string) => runtimes[file] ?? 24),
}));

const episode = (season: number, number: number, airDate: string, runtime = 24) => ({
  season_number: season,
  episode_number: number,
  name: `S${season}E${number}`,
  air_date: airDate,
  runtime,
  still_path: '/still.jpg',
});
const season = (number: number, episodes: ReturnType<typeof episode>[]) => ({
  season_number: number,
  name: `Season ${number}`,
  episodes,
});

// Dates and runtimes of TMDb
const mushoku = [
  season(0, [
    episode(0, 1, '2022-03-16'),
    episode(0, 2, '2023-07-03'),
    episode(0, 3, '2024-05-20'),
  ]),
  season(1, [episode(1, 1, '2021-01-11'), episode(1, 23, '2021-12-20')]),
  season(2, [episode(2, 1, '2023-07-10'), episode(2, 24, '2024-07-01')]),
];
const titans = [
  season(0, [
    episode(0, 35, '2023-02-28', 50),
    episode(0, 36, '2023-03-04', 61),
    episode(0, 37, '2023-11-05', 85),
  ]),
  season(4, [episode(4, 1, '2020-12-07'), episode(4, 28, '2022-04-04')]),
];

describe('matchSpecialEpisode', () => {
  const match = (...args: Parameters<typeof matchSpecialEpisode>) =>
    matchSpecialEpisode(...args)?.episode_number ?? null;

  it('finds the episode 0 aired just before its season', () => {
    expect(match(mushoku, 2, 0, 23.7)).toBe(2);
  });

  it('tells apart the extra final episodes by their duration', () => {
    expect(match(titans, 4, 29, 60.9)).toBe(36);
    expect(match(titans, 4, 30, 84.9)).toBe(37);
  });

  it('returns nothing when the match is not clear', () => {
    // No special with that duration
    expect(match(titans, 4, 29, 24)).toBeNull();
    // Two specials with that duration after the season
    const two = [
      season(0, [episode(0, 1, '2023-01-01'), episode(0, 2, '2023-02-01')]),
      season(1, [episode(1, 1, '2022-01-01'), episode(1, 12, '2022-03-01')]),
    ];
    expect(match(two, 1, 13, 24)).toBeNull();
    // Unknown duration of the file
    expect(match(mushoku, 2, 0, 0)).toBeNull();
    // The only specials aired long before the season
    expect(match(mushoku, 1, 0, 23.7)).toBeNull();
  });
});

describe('ScanSeriesUseCase with episodes TMDb does not list in the season', () => {
  const run = async (files: string[]) => {
    const episodes: Record<string, unknown>[] = [];
    const videos: Record<string, unknown>[] = [];
    const seasons: Record<string, unknown>[] = [];
    const metadataProvider = {
      updateSeasonMetadata: jest.fn(),
      updateEpisodeMetadata: jest.fn(async () => {}),
    };
    const useCase = new ScanSeriesUseCase(
      {} as never,
      { addAnalyzedFile: jest.fn() } as never,
      {} as never,
      {
        findSeasonsBySeriesId: jest.fn(async () => seasons),
        create: jest.fn(async (data) => {
          const created = { ...data, id: `season-${seasons.length}` };
          seasons.push(created);
          return created;
        }),
        update: jest.fn(),
      } as never,
      {
        findByEpisodeId: jest.fn(async () => null),
        addAsEpisode: jest.fn(async (episodeId, data) => {
          const video = { ...data, id: `video-${videos.length}`, runtime: 24, audioTracks: [{}] };
          videos.push(video);
          return video;
        }),
        update: jest.fn(),
      } as never,
      {
        findAllBySeasonId: jest.fn(async () => episodes),
        create: jest.fn(async (data) => {
          const created = { ...data, id: `episode-${episodes.length}` };
          episodes.push(created);
          return created;
        }),
      } as never,
      metadataProvider as never,
      { mutateSeries: jest.fn(), mutateSeason: jest.fn(), broadcast: jest.fn() } as never,
    );

    await useCase.processEpisodes(
      { id: 'library', language: 'es-ES', analyzedFiles: {} } as never,
      files,
      { id: 'series', themdbId: 1, overview: '' } as never,
      mushoku as never,
      undefined,
    );

    return { episodes, videos, metadataProvider };
  };

  beforeEach(() => generateVideoThumbnail.mockClear());

  it('registers the episode 0 with the number of the file and the metadata of the special', async () => {
    const { episodes, metadataProvider } = await run(['Show - S02E00.mkv']);

    expect(episodes).toEqual([
      expect.objectContaining({
        seasonNumber: 2,
        episodeNumber: 0,
        name: 'S0E2',
        metadataSeason: 0,
        metadataEpisode: 2,
      }),
    ]);
    expect(metadataProvider.updateEpisodeMetadata).toHaveBeenCalledTimes(1);
    expect(generateVideoThumbnail).not.toHaveBeenCalled();
  });

  it('registers a file without any match with a frame of the video as thumbnail', async () => {
    runtimes['Show - S02E25.mkv'] = 90;

    const { episodes, videos, metadataProvider } = await run(['Show - S02E25.mkv']);

    expect(episodes).toEqual([
      expect.objectContaining({ seasonNumber: 2, episodeNumber: 25, name: 'Episodio 25' }),
    ]);
    expect(episodes[0]).not.toHaveProperty('metadataEpisode');
    expect(videos[0].imgSrc).toBe('resources/img/thumbnails/video/video-0/frame.jpg');
    expect(metadataProvider.updateEpisodeMetadata).not.toHaveBeenCalled();
  });

  it('skips a file whose name has no explicit season and episode', async () => {
    const { episodes } = await run(['Show 2 part 40.mkv']);

    expect(episodes).toEqual([]);
  });
});
