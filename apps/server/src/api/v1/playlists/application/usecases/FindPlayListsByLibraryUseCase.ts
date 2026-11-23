import type { PlayList } from '../../domain/PlayList';
import type { PlayListRepositoryPort } from '../ports/PlayListRepositoryPort';

export class FindPlayListsByLibraryUseCase {
  constructor(private playlistRepo: PlayListRepositoryPort) {}

  async execute(libraryId: string): Promise<PlayList[]> {
    return this.playlistRepo.findByLibrary(libraryId);
  }
}
