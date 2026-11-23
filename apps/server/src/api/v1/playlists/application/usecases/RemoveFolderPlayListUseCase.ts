import type { SongsRepositoryPort } from '@/api/v1/songs/application/ports/SongsRepositoryPort';
import type { PlayList } from '../../domain/PlayList';
import { isPathInsideFolder } from '../../domain/PlayListFolder';
import type { PlayListRepositoryPort } from '../ports/PlayListRepositoryPort';

/**
 * Removes a folder-based playlist together with the local songs that only exist
 * because of it. Songs referenced from other locations are never touched.
 */
export class RemoveFolderPlayListUseCase {
  constructor(
    private playlistRepo: PlayListRepositoryPort,
    private songsRepo: SongsRepositoryPort,
  ) {}

  async execute(playList: PlayList): Promise<void> {
    if (playList.folder) {
      const albumlessSongs = await this.songsRepo.findWithoutAlbum();
      for (const song of albumlessSongs) {
        if (song.id && isPathInsideFolder(song.fileSrc, playList.folder)) {
          await this.songsRepo.delete(song.id);
        }
      }
    }

    await this.playlistRepo.delete(playList.id);
  }
}
