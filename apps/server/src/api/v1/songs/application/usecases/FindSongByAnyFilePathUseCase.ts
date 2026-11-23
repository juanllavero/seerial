import type { Song } from '../../domain/Song';
import type { SongsRepositoryPort } from '../ports/SongsRepositoryPort';

/** Finds a song from any of its files: the original, its Dolby Atmos version or its karaoke stems. */
export class FindSongByAnyFilePathUseCase {
  constructor(private songsRepo: SongsRepositoryPort) {}

  async execute(path: string): Promise<Song | null> {
    return this.songsRepo.findByAnyFilePath(path);
  }
}
