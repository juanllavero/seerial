import type { CollectionsRepositoryPort } from '../ports/CollectionsRepositoryPort';

export class LinkCollectionLibrariesUseCase {
  constructor(private collectionRepo: CollectionsRepositoryPort) {}

  async execute(): Promise<void> {
    await this.collectionRepo.linkCollectionLibraries();
  }
}
