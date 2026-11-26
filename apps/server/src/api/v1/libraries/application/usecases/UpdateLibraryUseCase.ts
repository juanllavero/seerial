import { TrackSelectionService } from '@/api/v1/shared/infrastructure/services/TrackSelectionService';
import logger from '@/utils/logger';
import type { Library } from '../../domain/Library';
import type { LibrariesRepositoryPort } from '../ports/LibrariesRepositoryPort';

const TRACK_PREFERENCE_FIELDS = ['preferAudioLan', 'preferSubLan', 'subsMode'] as const;

export class UpdateLibraryUseCase {
  constructor(private librariesRepo: LibrariesRepositoryPort) {}

  async execute(id: string, data: Partial<Library>): Promise<Library> {
    const touchesTracks = TRACK_PREFERENCE_FIELDS.some((field) => data[field] !== undefined);
    const previous = touchesTracks ? await this.librariesRepo.getById(id) : null;

    const updated = await this.librariesRepo.update(id, data);

    // The tracks of the videos follow these preferences: select them again, without making the
    // caller wait for a big library
    if (previous && TRACK_PREFERENCE_FIELDS.some((field) => (previous[field] ?? '') !== (updated[field] ?? ''))) {
      TrackSelectionService.applyToLibrary(id, true).catch((error) =>
        logger.error({ libraryId: id, error }, 'Failed to select the default tracks'),
      );
    }

    return updated;
  }
}
