import { changeIdentificationShow } from '@/api/v1/shared/infrastructure/services/FileSearchService';
import logger from '@/utils/logger';

export class UpdateShowIdUseCase {
  async execute(id: string, themdbId: number): Promise<void> {
    // Takes long: the clients are told when it ends
    Promise.resolve(changeIdentificationShow(id, themdbId)).catch((error) =>
      logger.error({ error, id, themdbId }, 'Failed to change the identification'),
    );
  }
}
