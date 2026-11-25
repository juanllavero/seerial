import path from 'node:path';
import { LOCAL_DATA_PATH } from '@/utils/constants';
import logger from '@/utils/logger';
import type { IMDBScoreServicePort } from '../../../application/ports/IMDBScoreServicePort';
import { ImdbRatingsDataset } from './ImdbRatingsDataset';

const imdbLogger = logger.child({ category: 'IMDB Score' });

/**
 * IMDb ratings from IMDb's own public dataset (https://datasets.imdbws.com, for personal and
 * non-commercial use). The third-party API this used (api.imdbapi.dev) no longer exists: its
 * domain does not resolve anymore.
 */
export class IMDBScoreServiceImpl implements IMDBScoreServicePort {
  constructor(
    private readonly dataset = new ImdbRatingsDataset(() =>
      path.join(LOCAL_DATA_PATH, 'resources', 'cache', 'imdb', 'title.ratings.tsv'),
    ),
  ) {}

  /** The rating (0-10), or -1 when it is unknown or the dataset cannot be read. */
  async getIMDBScore(imdbID: string): Promise<number> {
    try {
      const rating = await this.dataset.getRating(imdbID);
      if (rating !== null) return rating;

      imdbLogger.warn({ imdbID }, 'IMDb score not found in the ratings dataset');
      return -1;
    } catch (error: unknown) {
      imdbLogger.warn(
        { imdbID, message: error instanceof Error ? error.message : String(error) },
        'IMDb score request failed',
      );
      return -1;
    }
  }
}
