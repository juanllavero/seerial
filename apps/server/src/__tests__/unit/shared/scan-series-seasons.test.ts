import { ScanSeriesUseCase } from '@/api/v1/series/application/usecases/ScanSeriesUseCase';

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  downloaderService: {},
}));
jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/mediaInfo', () => ({ getMediaInfo: jest.fn() }));

interface FakeSeason {
  id: string;
  seasonNumber: number;
  name: string;
}

function createUseCase() {
  const seasons: FakeSeason[] = [];
  const seasonsRepo = {
    findSeasonsBySeriesId: jest.fn(async () => seasons),
    create: jest.fn(async (data: Omit<FakeSeason, 'id'>) => {
      const season = { ...data, id: `season-${seasons.length}` };
      seasons.push(season);
      return season;
    }),
    update: jest.fn(),
  };
  const metadataProvider = { updateSeasonMetadata: jest.fn() };
  const notificationService = { mutateSeries: jest.fn() };

  const useCase = new ScanSeriesUseCase(
    {} as never,
    {} as never,
    {} as never,
    seasonsRepo as never,
    {} as never,
    {} as never,
    metadataProvider as never,
    notificationService as never,
  );
  return { useCase, seasons };
}

describe('ScanSeriesUseCase.extractEpisodeSeason', () => {
  const { useCase } = createUseCase();

  it('reads the season and the episode of the file name', () => {
    expect(useCase.extractEpisodeSeason('One Piece S02E05')).toEqual([5, 2]);
  });

  it('keeps season 0 (specials) instead of taking it as an absolute number', () => {
    expect(useCase.extractEpisodeSeason('One Piece S00E11 - 3D2Y')).toEqual([11, 0]);
    expect(useCase.extractEpisodeSeason('One Piece S00E33')).toEqual([33, 0]);
  });

  it('only returns the episode when the file has an absolute number', () => {
    expect(useCase.extractEpisodeSeason('[Anime Time] Naruto Shippuden - 001 - Homecoming')).toEqual([1]);
  });
});

describe('ScanSeriesUseCase.ensureSeason', () => {
  const show = { id: 'series', overview: '' } as never;
  const metadata = (seasonNumber: number, name: string) =>
    ({ season_number: seasonNumber, name, episodes: [{ air_date: '2007-02-15' }] }) as never;

  it('reuses the season of the metadata for the files with an absolute number', async () => {
    const { useCase, seasons } = createUseCase();

    // Naruto Shippuden - 001, - 002 and - 003: all of them are in the first season of TMDb
    for (const absolute of [1, 2, 3]) {
      await useCase.ensureSeason(show, metadata(1, 'Kazekage'), undefined, absolute);
    }
    await useCase.ensureSeason(show, metadata(2, 'Sasuke'), undefined, 40);

    expect(seasons.map((season) => season.seasonNumber)).toEqual([1, 2]);
  });

  it('uses the season of the file name, including season 0 for the specials', async () => {
    const { useCase, seasons } = createUseCase();

    await useCase.ensureSeason(show, metadata(0, 'Specials'), 0, 11);
    await useCase.ensureSeason(show, metadata(0, 'Specials'), 0, 12);
    await useCase.ensureSeason(show, metadata(2, 'Season 2'), 2, 1);
    await useCase.ensureSeason(show, metadata(2, 'Season 2'), 2, 2);

    expect(seasons.map((season) => season.seasonNumber)).toEqual([0, 2]);
  });
});
