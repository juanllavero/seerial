import type { Series } from '../../domain/Series';
import type { SeriesRepositoryPort } from '../ports/SeriesRepositoryPort';
import { TrackSelectionService } from '@/api/v1/shared/infrastructure/services/TrackSelectionService';
import logger from '@/utils/logger';

const TRACK_PREFERENCE_FIELDS = ['preferAudioLan', 'preferSubLan', 'subsMode'] as const;

export class UpdateSeriesUseCase {
  constructor(private seriesRepo: SeriesRepositoryPort) { }

  async execute(id: string, data: Partial<Series>): Promise<Series> {
    const series = await this.seriesRepo.findById(id, 'few');
    const updated = await this.seriesRepo.update(id, data);

    // The tracks of its episodes follow these preferences
    if (TRACK_PREFERENCE_FIELDS.some((field) => (series?.[field] ?? '') !== (updated?.[field] ?? ''))) {
      try {
        await TrackSelectionService.applyToSeries(id, true);
      } catch (error) {
        logger.error({ seriesId: id, error }, 'Failed to select the default tracks');
      }
    }

    return updated;
  }
}
