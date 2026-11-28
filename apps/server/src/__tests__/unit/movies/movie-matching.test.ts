import {
  findMovie,
  type MovieDetails,
  type MovieQuery,
  scoreMovie,
} from '@/api/v1/movies/application/services/movieMatching';
import { titleSimilarity } from '@/api/v1/shared/application/services/titleMatching';

const best = (query: MovieQuery, movies: MovieDetails[]) =>
  [...movies].sort((a, b) => scoreMovie(query, b) - scoreMovie(query, a))[0].id;

describe('movie matching', () => {
  it('ignores accents, case and punctuation in titles', () => {
    expect(titleSimilarity('La tumba de las luciernagas', 'La tumba de las luci\u00e9rnagas')).toBe(1);
  });

  it('chooses between movies with the same title by the duration of the file', () => {
    const query = { names: ['La tumba'], runtime: 88.5 };

    expect(
      best(query, [
        { id: 1, title: 'La tumba', runtime: 148, vote_count: 80 },
        { id: 2, title: 'La tumba', runtime: 89, vote_count: 5000 },
      ]),
    ).toBe(2);
  });

  it('prefers the exact title to a more popular one that only contains it', () => {
    const query = { names: ['El viento se levanta'], runtime: 126.5 };

    expect(
      best(query, [
        { id: 1, title: 'Blades: El viento se levanta en el desierto', runtime: 126, vote_count: 900 },
        { id: 2, title: 'El viento se levanta', runtime: 126, vote_count: 400 },
      ]),
    ).toBe(2);
  });

  it('matches the titles of other languages', () => {
    expect(
      best({ names: ['Wolf Children'] }, [
        { id: 1, title: 'Wolf Child', vote_count: 3000 },
        {
          id: 2,
          title: 'Los lobos',
          translations: { translations: [{ data: { title: 'Wolf Children' } }] },
        },
      ]),
    ).toBe(2);
  });

  it('asks the details of the results and returns the best one', async () => {
    const provider = {
      searchMovies: jest.fn().mockResolvedValue([
        { id: 1, title: 'La arquitectura de El viaje de Chihiro' },
        { id: 2, title: 'El viaje de Chihiro' },
      ]),
      getMovie: jest.fn(async (id: number) =>
        id === 1
          ? { id, title: 'La arquitectura de El viaje de Chihiro', runtime: 20 }
          : { id, title: 'El viaje de Chihiro', runtime: 125 },
      ),
    };

    const movie = await findMovie(
      provider as never,
      { names: ['El Viaje de Chihiro'], runtime: 124.5 },
      'es-ES',
    );

    expect(movie?.id).toBe(2);
    expect(provider.searchMovies).toHaveBeenCalledWith('El Viaje de Chihiro', '', 'es-ES');
  });
});
