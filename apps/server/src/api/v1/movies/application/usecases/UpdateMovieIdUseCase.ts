import { changeIdentificationMovie } from '@/api/v1/shared/infrastructure/services/FileSearchService';
import logger from '@/utils/logger';

export class UpdateMovieIdUseCase {
  async execute(id: string, themdbId: number): Promise<void> {
    // Takes long: the clients are told when it ends
    Promise.resolve(changeIdentificationMovie(id, themdbId)).catch((error) =>
      logger.error({ error, id, themdbId }, 'Failed to change the identification'),
    );
  }
}
