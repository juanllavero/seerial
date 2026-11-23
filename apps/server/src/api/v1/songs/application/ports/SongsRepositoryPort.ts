import type { Song } from '../../domain/Song';

export interface SongsRepositoryPort {
  findById(id: string): Promise<Song | null>;
  findByPath(path: string): Promise<Song | null>;
  /** Finds the song owning the file, either its original file or one of its companions (Atmos, vocals, instrumental). */
  findByAnyFilePath(path: string): Promise<Song | null>;
  findByAlbum(albumId: string): Promise<Song[]>;
  findWithoutAlbum(): Promise<Song[]>;
  create(album: Partial<Song>): Promise<Song | null>;
  update(id: string, album: Partial<Song>): Promise<Song>;
  delete(id: string): Promise<void>;
}
