import type { Movie } from '../../domain/Movie';
import type { MoviesRepositoryPort } from '../ports/MoviesRepositoryPort';
import { saveRemoteThemeMedia } from '@/api/v1/shared/infrastructure/services/artwork/saveRemoteThemeMedia';

export class UpdateMovieUseCase {
  constructor(private moviesRepo: MoviesRepositoryPort) {}

  async execute(id: string, data: Partial<Movie>): Promise<Movie> {
    await saveRemoteThemeMedia('movie', data, () => this.moviesRepo.findById(id));
    return this.moviesRepo.update(id, data);
  }
}
