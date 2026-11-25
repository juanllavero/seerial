import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ImdbRatingsDataset } from '@/api/v1/shared/infrastructure/adapters/imdb-score/ImdbRatingsDataset';

const header = 'tconst\taverageRating\tnumVotes';

// Sorted as text, like the real file: tt10000000 comes before tt1000001
const buildFile = (ids: string[]) =>
  [header, ...ids.map((id, i) => `${id}\t${(1 + (i % 90) / 10).toFixed(1)}\t${i * 7}`)].join('\n') + '\n';

describe('ImdbRatingsDataset', () => {
  let dir: string;
  let file: string;
  const originalFetch = global.fetch;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imdb-'));
    file = path.join(dir, 'cache', 'title.ratings.tsv');
  });
  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeFile = (content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  it('finds every title of a big sorted file, and none of the missing ones', async () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `tt${String(i * 3 + 1).padStart(7, '0')}`).sort();
    writeFile(buildFile(ids));
    const dataset = new ImdbRatingsDataset(() => file);

    for (const index of [0, 1, 2, 999, 2500, 4998, 4999]) {
      const expected = Number((1 + (index % 90) / 10).toFixed(1));
      expect(await dataset.getRating(ids[index])).toBe(expected);
    }
    expect(await dataset.getRating('tt0000002')).toBeNull(); // between two titles
    expect(await dataset.getRating('tt9999999')).toBeNull(); // after the last one
    expect(await dataset.getRating('tt0000000')).toBeNull(); // before the first one
  });

  it('works with tiny files and with ids of different lengths', async () => {
    writeFile(`${header}\ntt0000001\t5.7\t1\ntt10000000\t6.1\t2\ntt1000001\t7.2\t3\n`);
    const dataset = new ImdbRatingsDataset(() => file);

    expect(await dataset.getRating('tt0000001')).toBe(5.7);
    expect(await dataset.getRating('tt10000000')).toBe(6.1);
    expect(await dataset.getRating('tt1000001')).toBe(7.2);
    expect(await dataset.getRating('tt0000009')).toBeNull();
  });

  it('ignores ids that are not IMDb ids (nothing is read or downloaded)', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const dataset = new ImdbRatingsDataset(() => file);

    expect(await dataset.getRating('')).toBeNull();
    expect(await dataset.getRating('../../etc/passwd')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('downloads and unpacks the dataset when it is missing', async () => {
    const body = gzipSync(Buffer.from(buildFile(['tt0111161', 'tt0290334'])));
    global.fetch = jest.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    ) as unknown as typeof fetch;
    const dataset = new ImdbRatingsDataset(() => file);

    expect(await dataset.getRating('tt0290334')).toBe(1.1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['title.ratings.tsv']);
  });

  it('keeps using an old file when the refresh fails, and reports a missing one', async () => {
    writeFile(buildFile(['tt0111161']));
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.utimesSync(file, old, old);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    const dataset = new ImdbRatingsDataset(() => file);
    expect(await dataset.getRating('tt0111161')).toBe(1);

    fs.rmSync(file);
    await expect(new ImdbRatingsDataset(() => file).getRating('tt0111161')).rejects.toThrow('offline');
  });

  it('does not download again while the file is recent', async () => {
    writeFile(buildFile(['tt0111161']));
    global.fetch = jest.fn() as unknown as typeof fetch;
    const dataset = new ImdbRatingsDataset(() => file);

    await dataset.getRating('tt0111161');
    await dataset.getRating('tt0111161');

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
