/** biome-ignore-all lint/style/noNonNullAssertion: <Test file> */

import 'reflect-metadata';
import { EpisodeModel } from '@/api/v1/episodes/infrastructure/persistence/models/EpisodeModel';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { DeleteSeriesUseCase } from '@/api/v1/series/application/usecases/DeleteSeriesUseCase';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { DatabaseManager } from '@/api/v1/shared/infrastructure/persistence/DatabaseManager';
import { VideoModel } from '@/api/v1/videos/infrastructure/persistence/models/VideoModel';
import { LibraryTypes } from '@/data/interfaces/Media';
import { clearAllTables, closeTestDataSource, getTestDataSource } from '../../helpers/test-db';

const mockCleanup = { cleanVideo: jest.fn() };
jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  useCases: {},
  get contentCleanupService() {
    return mockCleanup;
  },
  fileSystemService: { getExternalPath: jest.fn().mockReturnValue('/test') },
}));

beforeAll(async () => {
  DatabaseManager.dataSource = await getTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await clearAllTables(await getTestDataSource());
});

async function createLibraryWithSeries(seasons: number) {
  const analyzedFiles: Record<string, string> = { '/other/file.mkv': 'other-episode' };
  for (let number = 1; number <= seasons; number++) analyzedFiles[`/anime/S1/${number}.mkv`] = `episode-${number}`;

  await LibraryModel.save({
    id: 'lib',
    name: 'Anime',
    type: LibraryTypes.SHOWS,
    language: 'es',
    folders: [],
    order: 0,
    hidden: false,
    analyzedFiles,
    analyzedFolders: { '/anime/S1': 'series', '/anime/other': 'other-series' },
  } as never);
  await SeriesModel.save({ id: 'series', libraryId: 'lib', name: 'Anime', folder: '/anime/S1' });

  // One season per episode, as the scanner used to create them
  for (let number = 1; number <= seasons; number++) {
    await SeasonModel.save({ id: `season-${number}`, seriesId: 'series', name: 'S', seasonNumber: 0, order: 0 });
    await EpisodeModel.save({
      id: `episode-${number}`,
      seasonId: `season-${number}`,
      name: `E${number}`,
      year: '2024',
      seasonNumber: 0,
      episodeNumber: number,
    });
    await VideoModel.save({
      id: `video-${number}`,
      episodeId: `episode-${number}`,
      fileSrc: `/anime/S1/${number}.mkv`,
    } as never);
  }
}

describe('DeleteSeriesUseCase', () => {
  const useCase = () =>
    new DeleteSeriesUseCase({
      findById: async (id: string) => SeriesModel.findOne({ where: { id } }),
      delete: async (id: string) => {
        await SeriesModel.delete(id);
      },
    } as never);

  it('removes the series with its seasons, episodes and videos, and forgets its files', async () => {
    await createLibraryWithSeries(40);

    await useCase().execute('series');

    expect(await SeriesModel.count()).toBe(0);
    expect(await SeasonModel.count()).toBe(0);
    expect(await EpisodeModel.count()).toBe(0);
    expect(await VideoModel.count()).toBe(0);

    const library = (await LibraryModel.findOne({ where: { id: 'lib' } }))!;
    expect(library.analyzedFiles).toEqual({ '/other/file.mkv': 'other-episode' });
    expect(library.analyzedFolders).toEqual({ '/anime/other': 'other-series' });
    expect(mockCleanup.cleanVideo).toHaveBeenCalledTimes(40);
  });

  it('does not take longer for series with many seasons', async () => {
    await createLibraryWithSeries(300);

    const start = Date.now();
    await useCase().execute('series');

    expect(Date.now() - start).toBeLessThan(2000);
    expect(await SeasonModel.count()).toBe(0);
  });

  it('answers not found for a missing series', async () => {
    await expect(useCase().execute('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
