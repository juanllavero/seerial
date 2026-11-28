import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { contentCleanupService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { NotFoundException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { VideoModel } from '@/api/v1/videos/infrastructure/persistence/models/VideoModel';
import type { SeriesRepositoryPort } from '../ports/SeriesRepositoryPort';

export class DeleteSeriesUseCase {
  constructor(private seriesRepo: SeriesRepositoryPort) {}

  /**
   * Removes a series with its seasons, episodes and videos. Seasons, episodes and videos go away
   * with the series row (ON DELETE CASCADE), so the work does not grow with the number of seasons:
   * the library is read and written once instead of once per video.
   *
   * With `keepSeries` only its content goes away, to identify its files again: the series keeps its
   * place in collections, lists and libraries.
   */
  async execute(id: string, { keepSeries = false } = {}): Promise<void> {
    const series = await this.seriesRepo.findById(id);
    if (!series) throw new NotFoundException(`Series with ID ${id} not found`);

    const library = await LibraryModel.findOne({ where: { id: series.libraryId } });
    if (!library) return;

    const videos = await VideoModel.createQueryBuilder('v')
      .select(['v.id', 'v.fileSrc'])
      .innerJoin('v.episode', 'e')
      .innerJoin('e.season', 's')
      .where('s.seriesId = :seriesId', { seriesId: id })
      .getMany();

    // The thumbnails of its videos. The media folder of the series is the user's: it stays
    for (const video of videos) contentCleanupService.cleanVideo(video.id);

    // Forget the files (and the folder), so the next scan analyzes them again
    const analyzedFiles = { ...library.analyzedFiles };
    for (const video of videos) delete analyzedFiles[video.fileSrc];
    const analyzedFolders = { ...library.analyzedFolders };
    if (keepSeries) analyzedFolders[series.folder] = id;
    else delete analyzedFolders[series.folder];
    await LibraryModel.update(library.id, { analyzedFiles, analyzedFolders });

    if (keepSeries) await SeasonModel.delete({ seriesId: id });
    else await this.seriesRepo.delete(id);
  }
}
