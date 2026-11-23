import { LocalSourceDeletionException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { messages } from '@/config/messages';
import type { SongsRepositoryPort } from '../ports/SongsRepositoryPort';

export interface DeleteSongOptions {
  /** Bypasses the local-source protection. Reserved for library cleanup of files already missing on disk. */
  force?: boolean;
}

export class DeleteSongUseCase {
  constructor(private songsRepo: SongsRepositoryPort) {}

  async execute(id: string, options: DeleteSongOptions = {}): Promise<void> {
    if (!options.force) {
      const song = await this.songsRepo.findById(id);

      // Songs without album only exist because they live in a playlist folder
      if (song && !song.albumId) {
        throw new LocalSourceDeletionException(messages.errors.conflict.localSong);
      }
    }

    await this.songsRepo.delete(id);
  }
}
