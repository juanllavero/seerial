import { createWriteStream } from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';

/** IMDb refreshes the dataset daily; a week-old file is plenty for a rating. */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Longest line of the file: `tt1234567890<TAB>10.0<TAB>12345678` plus the newline. */
const MAX_LINE_BYTES = 64;

/**
 * IMDb's public ratings dataset (`title.ratings.tsv`, ~30 MB, sorted by title id), kept on disk and
 * searched with a binary search: looking up a rating reads a few hundred bytes, and nothing big
 * stays in memory. The file is downloaded when missing and refreshed when it gets old; if the
 * refresh fails, the old file keeps being used.
 */
export class ImdbRatingsDataset {
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly filePath: () => string,
    private readonly options: { url?: string; maxAgeMs?: number } = {},
  ) {}

  /** Rating of the title (`tt0111161`), or null when it has no rating in the dataset. */
  async getRating(imdbId: string): Promise<number | null> {
    if (!/^tt\d+$/.test(imdbId)) return null;

    await this.ensureFresh();
    return this.search(imdbId);
  }

  /** Downloads the dataset when it is missing or old (once at a time). */
  ensureFresh(): Promise<void> {
    this.refreshing ??= this.refreshIfNeeded().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshIfNeeded(): Promise<void> {
    const file = this.filePath();
    const maxAge = this.options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

    const stats = await fsPromises.stat(file).catch(() => null);
    if (stats && Date.now() - stats.mtimeMs < maxAge) return;

    try {
      await this.download(file);
    } catch (error) {
      // An old file is still good; without any file there is nothing to search
      if (!stats) throw error;
    }
  }

  private async download(file: string): Promise<void> {
    const response = await fetch(this.options.url ?? IMDB_RATINGS_URL);
    if (!response.ok || !response.body) {
      throw new Error(`IMDb ratings dataset answered HTTP ${response.status}`);
    }

    await fsPromises.mkdir(path.dirname(file), { recursive: true });
    const partial = `${file}.download`;
    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        createGunzip(),
        createWriteStream(partial),
      );
      await fsPromises.rename(partial, file);
    } catch (error) {
      await fsPromises.rm(partial, { force: true });
      throw error;
    }
  }

  /**
   * Binary search over the byte offsets of the file (its lines are sorted by title id). `low` is
   * always the start of a line and `high` the start of a line (or the end), so the title, if it is
   * there, is in `[low, high)`.
   */
  private async search(imdbId: string): Promise<number | null> {
    const handle = await fsPromises.open(this.filePath(), 'r');
    try {
      const { size } = await handle.stat();
      const probe = Buffer.alloc(MAX_LINE_BYTES * 2);

      // Skip the header line ("tconst<TAB>averageRating<TAB>numVotes")
      const head = await handle.read(probe, 0, probe.length, 0);
      let low = probe.toString('utf8', 0, head.bytesRead).indexOf(NEWLINE) + 1;
      let high = size;

      while (high - low > SCAN_REGION_BYTES) {
        const middle = Math.floor((low + high) / 2);
        const { bytesRead } = await handle.read(probe, 0, probe.length, middle);
        const text = probe.toString('utf8', 0, bytesRead);

        // First line that starts after `middle`
        const lineStart = text.indexOf(NEWLINE) + 1;
        const lineEnd = text.indexOf(NEWLINE, lineStart);
        if (lineStart === 0 || lineEnd === -1) break; // Not a normal file: fall back to scanning

        const line = text.slice(lineStart, lineEnd);
        const id = line.slice(0, line.indexOf(TAB));
        if (id === imdbId) return parseRating(line);

        if (id < imdbId) {
          low = middle + lineEnd + 1;
        } else {
          high = middle + lineStart;
        }
      }

      // Few lines left: read them all
      const region = Buffer.alloc(high - low);
      await handle.read(region, 0, region.length, low);
      for (const line of region.toString('utf8').split(NEWLINE)) {
        if (line.slice(0, line.indexOf(TAB)) === imdbId) return parseRating(line);
      }
      return null;
    } finally {
      await handle.close();
    }
  }
}

const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

/** Lines to read at once when the binary search has narrowed the title down this far. */
const SCAN_REGION_BYTES = 512;

function parseRating(line: string): number | null {
  const value = Number(line.split(TAB)[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
