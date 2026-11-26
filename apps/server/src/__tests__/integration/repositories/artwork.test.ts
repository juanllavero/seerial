/** biome-ignore-all lint/style/noNonNullAssertion: <Test file> */
import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollectionModel } from '@/api/v1/collections/infrastructure/persistence/models/CollectionModel';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { artworkService } from '@/api/v1/shared/infrastructure/services/artwork/ArtworkService';
import { applyUserImages } from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import { migrateArtwork } from '@/api/v1/shared/infrastructure/services/artwork/migrateArtwork';
import { LibraryTypes } from '@/data/interfaces/Media';
import { downloadImage } from '@/utils/downloadImage';
import { clearAllTables, closeTestDataSource, getTestDataSource } from '../../helpers/test-db';

let appData = '';

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  fileSystemService: {
    getExternalPath: (relative: string) => require('node:path').join(appData, relative),
    deleteFolder: (folder: string) =>
      require('node:fs').rmSync(folder, { recursive: true, force: true }),
  },
}));
jest.mock('@/utils/downloadImage', () => ({
  downloadImage: jest.fn(),
  isRemoteUrl: (value: string) => value.startsWith('http'),
}));

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const download = downloadImage as jest.Mock;
const REMOTE = 'https://image.tmdb.org/t/p/original/new.jpg';

let root = '';

const write = (file: string, content: Buffer = JPG) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const list = (folder: string) => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);

const addMovie = (id: string, folder: string, extra: Partial<MovieModel> = {}) =>
  MovieModel.save({ id, libraryId: 'lib', folder, ...extra } as MovieModel);

beforeAll(async () => {
  await getTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource();
});

beforeEach(async () => {
  await clearAllTables(await getTestDataSource());
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'artwork-'));
  appData = path.join(temporary, 'app');
  root = path.join(temporary, 'library');
  fs.mkdirSync(root, { recursive: true });
  await LibraryModel.save({
    id: 'lib',
    name: 'Library',
    type: LibraryTypes.MOVIES,
    language: 'en',
    folders: [root],
    order: 0,
    hidden: false,
  });
  download.mockReset();
  download.mockImplementation(async (_url: string, destination: string) => {
    fs.writeFileSync(destination, JPG);
  });
});

describe('synchronization (scans)', () => {
  it('saves the internet images next to the movie', async () => {
    const folder = path.join(root, 'Akira');
    fs.mkdirSync(folder);
    const movie = { id: 'm', folder, coverSrc: REMOTE };

    await artworkService.sync('movie', movie);

    expect(movie.coverSrc).toBe(path.join(folder, 'poster.jpg'));
    expect(list(folder)).toEqual(['poster.jpg']);
  });

  it('uses what the user has in local instead of the one of internet, without replacing it', async () => {
    const folder = path.join(root, 'Akira');
    const own = write(path.join(folder, 'poster.png'), PNG);
    const movie = { id: 'm', folder, coverSrc: REMOTE };

    await artworkService.sync('movie', movie);

    expect(movie.coverSrc).toBe(own);
    expect(download).not.toHaveBeenCalled();
    expect(fs.readFileSync(own)).toEqual(PNG);
  });

  it('does nothing when the folder is not reachable', async () => {
    const movie = { id: 'm', folder: path.join(root, 'unplugged'), coverSrc: REMOTE };

    await artworkService.sync('movie', movie);

    expect(movie.coverSrc).toBe(REMOTE);
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps the images of a movie without folder in the application, found again by its path', async () => {
    const file = write(path.join(root, 'Paprika (2006).mkv'));
    const movie = { id: 'first', folder: file, coverSrc: REMOTE };

    await artworkService.sync('movie', movie);

    expect(movie.coverSrc.startsWith(appData)).toBe(true);
    expect(list(root)).toEqual(['Paprika (2006).mkv']);
    // Removed and added again, with another id
    expect(await artworkService.find('movie', { id: 'second', folder: file })).toEqual({
      coverSrc: movie.coverSrc,
    });
  });

  it('names the images of a season by its number, in the folder of the series', async () => {
    const folder = path.join(root, 'Show');
    fs.mkdirSync(folder);
    await SeriesModel.save({ id: 's', libraryId: 'lib', folder } as SeriesModel);
    const season = { id: 'x', seriesId: 's', seasonNumber: 1, backgroundSrc: REMOTE };

    await artworkService.sync('season', season);

    expect(season.backgroundSrc).toBe(path.join(folder, 'season01-background.jpg'));
  });
});

describe('SVG logos', () => {
  it('moves them like any other image, and rejects web pages', async () => {
    const folder = path.join(root, 'Akira');
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    await addMovie('m', folder, { logoSrc: write(path.join(folder, 'media', 'logo.svg'), svg) });

    await migrateArtwork();

    expect(list(folder)).toEqual(['logo.svg', 'media']);
    download.mockImplementation(async (_url: string, destination: string) => {
      fs.writeFileSync(destination, '<!DOCTYPE html><html><svg></svg></html>');
    });
    await expect(applyUserImages('movie', 'm', { logoSrc: REMOTE })).rejects.toThrow();
    expect(list(folder)).toEqual(['logo.svg', 'media']);
  });
});

describe('collections', () => {
  const addCollection = async (folders: string[]) => {
    await CollectionModel.save({ id: 'c', title: 'Alien' } as CollectionModel);
    for (const [index, folder] of folders.entries()) {
      fs.mkdirSync(folder, { recursive: true });
      await addMovie(`m${index}`, folder, { collectionId: 'c' });
    }
  };

  it('uses the folder that only holds its items', async () => {
    await addCollection([path.join(root, 'Alien', 'Alien'), path.join(root, 'Alien', 'Aliens')]);

    expect((await artworkService.locate('collection', { id: 'c' }))!.folder).toBe(
      path.join(root, 'Alien'),
    );
  });

  it('uses the common folder when the items are in subfolders of it', async () => {
    const saga = path.join(root, 'Middle-Earth');
    await addCollection([path.join(saga, 'Hobbit', 'One'), path.join(saga, 'Rings', 'Two')]);

    expect((await artworkService.locate('collection', { id: 'c' }))!.folder).toBe(saga);
  });

  it('uses the application when the folder has other things or is a library folder', async () => {
    await addCollection([path.join(root, 'Alien', 'Alien')]);
    await addMovie('other', path.join(root, 'Alien', 'Not in the collection'));
    expect((await artworkService.locate('collection', { id: 'c' }))!.folder.startsWith(appData)).toBe(
      true,
    );

    await clearAllTables(await getTestDataSource());
    await LibraryModel.save({ id: 'lib', name: 'L', type: LibraryTypes.MOVIES, language: 'en', folders: [root], order: 0, hidden: false });
    await addCollection([path.join(root, 'Loose')]);
    expect((await artworkService.locate('collection', { id: 'c' }))!.folder.startsWith(appData)).toBe(
      true,
    );
  });

  it('saves the poster chosen in the web, which calls it coverSrc', async () => {
    await addCollection([path.join(root, 'Alien', 'Alien')]);

    const data = await applyUserImages('collection', 'c', { coverSrc: REMOTE });

    expect(data).toEqual({ posterSrc: path.join(root, 'Alien', 'poster.jpg') });
  });
});

describe('user edits', () => {
  const setup = async () => {
    const folder = path.join(root, 'Akira');
    const poster = write(path.join(folder, 'poster.png'), PNG);
    await addMovie('m', folder, { coverSrc: poster });
    return { folder, poster };
  };

  it('replaces the previous image whatever its extension', async () => {
    const { folder } = await setup();

    const data = await applyUserImages('movie', 'm', { coverSrc: REMOTE });

    expect(data.coverSrc).toBe(path.join(folder, 'poster.jpg'));
    expect(list(folder)).toEqual(['poster.jpg']);
  });

  it('keeps the previous image when the new one cannot be downloaded', async () => {
    const { folder, poster } = await setup();
    download.mockRejectedValue(new Error('offline'));

    await expect(applyUserImages('movie', 'm', { coverSrc: REMOTE })).rejects.toThrow('offline');

    expect(list(folder)).toEqual(['poster.png']);
    expect(fs.readFileSync(poster)).toEqual(PNG);
  });

  it('keeps the previous image when what is downloaded is not an image', async () => {
    const { folder } = await setup();
    download.mockImplementation(async (_url: string, destination: string) => {
      fs.writeFileSync(destination, '<html>Not found</html>');
    });

    await expect(applyUserImages('movie', 'm', { coverSrc: REMOTE })).rejects.toThrow();

    expect(list(folder)).toEqual(['poster.png']);
  });

  it('does not touch the images that did not change', async () => {
    const { poster } = await setup();

    await applyUserImages('movie', 'm', { coverSrc: poster, name: 'Akira' });

    expect(download).not.toHaveBeenCalled();
    expect(fs.existsSync(poster)).toBe(true);
  });
});

describe('migration from the media folders', () => {
  const setup = async () => {
    const movie = path.join(root, 'Akira');
    const series = path.join(root, 'Show');
    await addMovie('m', movie, {
      coverSrc: write(path.join(movie, 'media', 'poster.jpg')),
      logoSrc: REMOTE,
    });
    write(path.join(movie, 'media', 'theme.mp3'));
    write(path.join(movie, 'media', 'unused.jpg'));
    // Selected in the web with a random name, stored as the address that served it
    const random = write(path.join(series, 'media', '19001073.jpg'));
    await SeriesModel.save({
      id: 's',
      libraryId: 'lib',
      folder: series,
      coverSrc: `/api/images/local?path=${encodeURIComponent(random)}`,
    } as SeriesModel);
    write(path.join(series, 'media', 's1_background.jpg'));
    await SeasonModel.save({
      id: 'x',
      seriesId: 's',
      seasonNumber: 1,
      backgroundSrc: REMOTE,
    } as SeasonModel);
    return { movie, series };
  };

  it('writes nothing in a dry run', async () => {
    const { movie, series } = await setup();

    const report = await migrateArtwork({ dryRun: true });

    expect(report.copied).toHaveLength(3);
    expect(list(movie)).toEqual(['media']);
    expect(list(path.join(series, 'media'))).toEqual(['19001073.jpg', 's1_background.jpg']);
    expect((await MovieModel.findOne({ where: { id: 'm' } }))!.coverSrc).toContain('media');
  });

  it('moves the images next to the content, leaving other files and remote images alone', async () => {
    const { movie, series } = await setup();

    await migrateArtwork();

    expect(list(movie)).toEqual(['media', 'poster.jpg']);
    expect(list(path.join(movie, 'media'))).toEqual(['theme.mp3', 'unused.jpg']);
    expect(list(series)).toEqual(['media', 'poster.jpg', 'season01-background.jpg']);
    expect(list(path.join(series, 'media'))).toEqual([]);
    const saved = (await MovieModel.findOne({ where: { id: 'm' } }))!;
    expect(saved.coverSrc).toBe(path.join(movie, 'poster.jpg'));
    expect(saved.logoSrc).toBe(REMOTE);
    expect(download).not.toHaveBeenCalled();

    const again = await migrateArtwork();
    expect(again.copied).toEqual([]);
    expect(again.removed).toEqual([]);
  });

  it('never overwrites an image already next to the content', async () => {
    const { movie } = await setup();
    const own = write(path.join(movie, 'poster.png'), PNG);

    await migrateArtwork();

    expect(fs.readFileSync(own)).toEqual(PNG);
    expect(fs.existsSync(path.join(movie, 'media', 'poster.jpg'))).toBe(true);
  });
});
