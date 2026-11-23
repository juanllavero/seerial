import { LocalSourceDeletionException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import type { SongsRepositoryPort } from '@/api/v1/songs/application/ports/SongsRepositoryPort';
import { messages } from '@/config/messages';
import { isPathInsideFolder } from '../../domain/PlayListFolder';
import type { PlayListRepositoryPort } from '../ports/PlayListRepositoryPort';

export class RemoveSongFromPlayListUseCase {
  constructor(
    private playlistRepo: PlayListRepositoryPort,
    private songsRepo: SongsRepositoryPort,
  ) {}

  async execute(playlistId: string, songId: string): Promise<void> {
    const playList = await this.playlistRepo.findById(playlistId);

    if (playList?.folder) {
      const song = await this.songsRepo.findById(songId);
      const isLocalSong =
        !!song && !song.albumId && isPathInsideFolder(song.fileSrc, playList.folder);

      if (isLocalSong) {
        throw new LocalSourceDeletionException(messages.errors.conflict.localSong);
      }
    }

    return this.playlistRepo.removeSongFromPlaylist(playlistId, songId);
  }
}
