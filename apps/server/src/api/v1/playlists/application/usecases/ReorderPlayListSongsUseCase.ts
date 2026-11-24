import type { PlayListRepositoryPort } from '../ports/PlayListRepositoryPort';

export class ReorderPlayListSongsUseCase {
  constructor(private playlistRepo: PlayListRepositoryPort) {}

  async execute(playlistId: string, orderedSongIds: string[]): Promise<boolean> {
    return this.playlistRepo.reorderSongs(playlistId, orderedSongIds);
  }
}
