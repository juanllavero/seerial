import type { PlayList } from '../../domain/PlayList';

export interface PlayListRepositoryPort {
  findAll(): Promise<PlayList[]>;
  findById(id: string): Promise<PlayList | null>;
  findByFolder(folder: string): Promise<PlayList | null>;
  findByLibrary(libraryId: string): Promise<PlayList[]>;
  create(playList: PlayList): Promise<PlayList>;
  update(id: string, playList: Partial<PlayList>): Promise<PlayList>;
  delete(id: string): Promise<void>;
  addSongToPlaylist(playlistId: string, songId: string): Promise<void>;
  reorderSongs(playlistId: string, orderedSongIds: string[]): Promise<boolean>;
  removeSongFromPlaylist(playlistId: string, songId: string): Promise<void>;
}
