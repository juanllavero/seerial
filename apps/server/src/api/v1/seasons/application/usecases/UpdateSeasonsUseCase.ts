import type { Season } from '../../domain/Season';
import type { SeasonsRepositoryPort } from '../ports/SeasonsRepositoryPort';
import { saveRemoteThemeMedia } from '@/api/v1/shared/infrastructure/services/artwork/saveRemoteThemeMedia';

export class UpdateSeasonUseCase {
  constructor(private seasonsRepo: SeasonsRepositoryPort) {}

  async execute(id: string, data: Partial<Season>): Promise<Season> {
    await saveRemoteThemeMedia('season', data, () => this.seasonsRepo.findById(id, 'few'));
    return await this.seasonsRepo.update(id, data);
  }
}
