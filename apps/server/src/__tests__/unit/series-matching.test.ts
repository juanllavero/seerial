import type { MetadataProviderPort } from '@/api/v1/shared/application/ports/MetadataProviderPort';
import {
  findSeries,
  scoreSeries,
  type SeriesDetails,
  type SeriesQuery,
} from '@/api/v1/series/application/services/seriesMatching';

const anime: SeriesDetails = {
  id: 1,
  name: 'One Piece',
  first_air_date: '1999-10-20',
  episode_run_time: [24],
  seasons: [{ season_number: 1, episode_count: 61 }],
  vote_count: 4000,
};

const liveAction: SeriesDetails = {
  id: 2,
  name: 'ONE PIECE',
  first_air_date: '2023-08-31',
  last_episode_to_air: { runtime: 55 },
  seasons: [{ season_number: 1, episode_count: 8 }],
  vote_count: 5000,
};

const query = (partial: Partial<SeriesQuery> = {}): SeriesQuery => ({
  names: ['One Piece'],
  episodes: [],
  ...partial,
});

describe('series matching', () => {
  it('tells apart two series with the same name by the episodes of the files', () => {
    const files = query({ episodes: [{ episode: 1 }, { episode: 40 }] });

    expect(scoreSeries(files, anime)).toBeGreaterThan(scoreSeries(files, liveAction));
  });

  it('uses the duration and the year', () => {
    const long = query({ runtime: 56, year: '2023', episodes: [{ season: 1, episode: 3 }] });

    expect(scoreSeries(long, liveAction)).toBeGreaterThan(scoreSeries(long, anime));
  });

  it('finds the title in other languages', () => {
    const show: SeriesDetails = {
      id: 3,
      name: 'Guardianes de la Noche',
      translations: { translations: [{ data: { name: 'Kimetsu no Yaiba' } }] },
    };
    const files = query({ names: ['Kimetsu no Yaiba'] });

    expect(scoreSeries(files, show)).toBeGreaterThan(scoreSeries(files, anime));
  });

  it('prefers the continuation with a subtitle when the year is its own', () => {
    const original: SeriesDetails = { id: 4, name: 'Midnight Diner', first_air_date: '2009-10-09' };
    const sequel: SeriesDetails = {
      id: 5,
      name: 'Midnight Diner: Tokyo Stories',
      first_air_date: '2016-10-21',
    };
    const files = query({ names: ['Midnight Diner'], year: '2016' });

    expect(scoreSeries(files, sequel)).toBeGreaterThan(scoreSeries(files, original));
    // Without a year, the exact title wins
    const noYear = query({ names: ['Midnight Diner'] });
    expect(scoreSeries(noYear, original)).toBeGreaterThan(scoreSeries(noYear, sequel));
  });

  it('does not take the first result of the search', async () => {
    const provider = {
      searchTVShows: jest.fn().mockResolvedValue([
        { id: 2, name: 'ONE PIECE' },
        { id: 1, name: 'One Piece' },
      ]),
      getTVShow: jest.fn(async (id: number) => (id === 1 ? anime : liveAction)),
    } as unknown as MetadataProviderPort;

    const found = await findSeries(
      provider,
      query({ year: '1999', episodes: [{ episode: 30 }] }),
      'es',
    );

    expect(found?.id).toBe(1);
  });

  it('returns nothing when the search has no results', async () => {
    const provider = {
      searchTVShows: jest.fn().mockResolvedValue([]),
      getTVShow: jest.fn(),
    } as unknown as MetadataProviderPort;

    expect(await findSeries(provider, query(), 'es')).toBeNull();
  });
});
