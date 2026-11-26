import { SetSeasonWatchStateUseCase } from '@/api/v1/seasons/application/usecases/SetSeasonWatchStateUseCase';

const SEASONS = [
  { id: 's1', seasonNumber: 1, seriesId: 'serie', episodes: [{ id: 'e1', episodeNumber: 1 }] },
  { id: 's2', seasonNumber: 2, seriesId: 'serie', episodes: [{ id: 'e2', episodeNumber: 1 }] },
  { id: 's3', seasonNumber: 3, seriesId: 'serie', episodes: [{ id: 'e3', episodeNumber: 1 }] },
];

function setup(pendingVideoId?: string) {
  const watchList = {
    addVideo: jest.fn(),
    removeVideo: jest.fn(),
    addSeason: jest.fn(),
    removeSeason: jest.fn(),
    addSeries: jest.fn(),
    removeSeries: jest.fn(),
    clearContinueWatching: jest.fn(),
    addContinueWatchingVideo: jest.fn(),
    isVideoWatched: jest.fn().mockResolvedValue(false),
    findByVideoIdAndUserId: jest.fn(async (videoId: string) =>
      videoId === pendingVideoId ? { watched: false, seriesId: 'serie' } : null,
    ),
  };
  const useCase = new SetSeasonWatchStateUseCase(
    { findById: async (id: string) => SEASONS.find((s) => s.id === id) } as never,
    { findById: async () => ({ seasons: SEASONS }) } as never,
    { findByEpisodeId: async (id: string) => ({ id: id.replace('e', 'v') }) } as never,
    watchList as never,
  );
  return { useCase, watchList };
}

describe('SetSeasonWatchStateUseCase', () => {
  it('marks only that season when it is not the last one', async () => {
    const { useCase, watchList } = setup();

    await useCase.execute('s2', 'user', true);

    expect(watchList.addVideo.mock.calls).toEqual([['user', 'v2']]);
    expect(watchList.addSeason.mock.calls).toEqual([['user', 's2']]);
    expect(watchList.addSeries).not.toHaveBeenCalled();
    expect(watchList.removeVideo).not.toHaveBeenCalled();
    expect(watchList.clearContinueWatching).not.toHaveBeenCalled();
  });

  it('moves "continue watching" to the next season when it was in the marked one', async () => {
    const { useCase, watchList } = setup('v1');

    await useCase.execute('s1', 'user', true);

    expect(watchList.addContinueWatchingVideo).toHaveBeenCalledWith('v2', 'user', 'serie');
  });

  it('marks the whole series when it is the last season', async () => {
    const { useCase, watchList } = setup();

    await useCase.execute('s3', 'user', true);

    expect(watchList.addVideo.mock.calls.map(([, video]) => video)).toEqual(['v1', 'v2', 'v3']);
    expect(watchList.addSeries).toHaveBeenCalledWith('user', 'serie');
    expect(watchList.clearContinueWatching).toHaveBeenCalledWith('user', 'serie');
  });

  it('unmarks only that season', async () => {
    const { useCase, watchList } = setup();

    await useCase.execute('s2', 'user', false);

    expect(watchList.removeVideo.mock.calls).toEqual([['user', 'v2']]);
    expect(watchList.removeSeries).toHaveBeenCalledWith('user', 'serie');
    expect(watchList.addVideo).not.toHaveBeenCalled();
  });
});
