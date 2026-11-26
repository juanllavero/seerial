import { contentCleanupService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { artworkService } from '@/api/v1/shared/infrastructure/services/artwork/ArtworkService';
import type { CollectionsRepositoryPort } from '../ports/CollectionsRepositoryPort';

export class DeleteCollectionUseCase {
  constructor(private collectionRepo: CollectionsRepositoryPort) { }

  async execute(id: string): Promise<boolean> {
    // Only the images kept in the application: the ones in a folder of the user stay
    contentCleanupService.cleanCollectionMedia(id);
    artworkService.removeAppImages('collection', id);
    return await this.collectionRepo.delete(id);
  }
}
