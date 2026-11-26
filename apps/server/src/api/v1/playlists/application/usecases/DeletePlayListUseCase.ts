import { artworkService } from '@/api/v1/shared/infrastructure/services/artwork/ArtworkService';
import { LocalSourceDeletionException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { messages } from '@/config/messages';
import type { PlayListRepositoryPort } from '../ports/PlayListRepositoryPort';

export class DeletePlayListUseCase {
  constructor(private playlistRepo: PlayListRepositoryPort) {}

  async execute(id: string): Promise<void> {
    const playList = await this.playlistRepo.findById(id);

    if (playList?.folder) {
      throw new LocalSourceDeletionException(messages.errors.conflict.localPlayList);
    }

    await this.playlistRepo.delete(id);
    artworkService.removeAppImages('playlist', id);
  }
}
