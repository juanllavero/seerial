import { artworkService } from '@/api/v1/shared/infrastructure/services/artwork/ArtworkService';
import {
  findContent,
  saveContentFields,
} from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import * as path from 'node:path';
import { parse } from 'node:path';
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import {
    fileSystemService,
    notificationService,
    useCases,
} from '@/api/v1/shared/infrastructure/adapters/di/container';
import logger from '@/utils/logger';

/**
 * Delete removed files from library
 * @param libraryId Library ID
 * @returns
 */
export async function clearLibrary(libraryId: string) {
  const library = await useCases.getLibrary().execute(libraryId);

  if (
    !library ||
    Object.keys(library.analyzedFiles).length === 0 ||
    !library.folders ||
    library.folders.length === 0
  )
    return;

  const fileToRootFolder = getFileToRootFolderMap(
    Object.keys(library.analyzedFiles),
    library.folders,
  );
  const type = library.type;
  const rootConnectivity = new Map<string, boolean>();

  for (const [filePath, rootFolder] of Object.entries(fileToRootFolder)) {
    if (!isRootConnected(rootFolder, rootConnectivity)) continue;
    if (fileSystemService.existsSync(filePath)) continue;

    await removeMissingFileFromLibrary(library.type, filePath);
  }

  if (
    (type === 'Shows' && library.series && library.series.length === 0) ||
    (type === 'Movies' && library.movies && library.movies.length === 0) ||
    (type === 'Music' && library.albums && library.albums.length === 0)
  ) {
    await useCases.deleteLibrary().execute(libraryId);
  }

  // Update library in client
  notificationService.mutateLibrary(libraryId);
}

function getFileToRootFolderMap(filePaths: string[], folders: string[]): Record<string, string> {
  const fileToRootFolder: Record<string, string> = {};

  for (const filePath of filePaths) {
    const matchingRootFolder = folders
      .filter((folder) => filePath.startsWith(folder))
      .sort((a, b) => b.length - a.length)[0];

    fileToRootFolder[filePath] = matchingRootFolder || parse(filePath).root;
  }

  return fileToRootFolder;
}

function isRootConnected(rootFolder: string, rootConnectivity: Map<string, boolean>): boolean {
  const resolvedRoot = path.resolve(rootFolder);
  const cached = rootConnectivity.get(resolvedRoot);
  if (cached !== undefined) return cached;

  if (fileSystemService.existsSync(resolvedRoot)) {
    rootConnectivity.set(resolvedRoot, true);
    return true;
  }

  logger.info(`Root folder ${resolvedRoot} is not connected. Its files will be skipped.`);
  rootConnectivity.set(resolvedRoot, false);
  return false;
}

async function removeMissingFileFromLibrary(type: string, filePath: string): Promise<void> {
  if (type === 'Shows') {
    await removeMissingShowFile(filePath);
    return;
  }

  if (type === 'Movies') {
    await removeMissingMovieFile(filePath);
    return;
  }

  await removeMissingMusicFile(filePath);
}

async function removeMissingShowFile(filePath: string): Promise<void> {
  const episode = await useCases.getEpisodeByPath().execute(filePath);
  if (!episode) return;

  await useCases.deleteEpisode().execute(episode.id);

  const season = await useCases.getSeasonById().execute(episode.seasonId);
  if (!season || (season.episodes && season.episodes.length > 0)) return;

  await useCases.deleteSeries().execute(season.seriesId);
}

async function removeMissingMovieFile(filePath: string): Promise<void> {
  const movie = await useCases.getMovieByPath().execute(filePath);
  if (!movie) return;
  await useCases.deleteMovie().execute(movie.id);
}

async function removeMissingMusicFile(filePath: string): Promise<void> {
  const song = await useCases.getSongByPath().execute(filePath);
  if (!song) return;

  const albumId = song.albumId;
  await useCases.deleteSong().execute(song.id ?? '', { force: true });
  if (!albumId) return;

  const album = await useCases.getAlbumById().execute(albumId);
  const songs = await useCases.getSongsByAlbum().execute(albumId);
  if (!album || songs.length > 0) return;

  await useCases.deleteAlbum().execute(albumId);
}

/**
 * Returns the key to use in the collection of items
 * @param value model name
 * @returns key
 */
export function getCollectionItemsKey(value: string) {
  switch (value) {
    case 'Movies':
      return 'movies';
    case 'Series':
      return 'shows';
    case 'Shows':
      return 'shows';
    case 'Music':
      return 'albums';
    default:
      throw new Error(`Invalid item value provided: ${value}`);
  }
}

/**
 * Returns the corresponding model for a given item type
 * @param type item type ('Movies', 'Shows', 'Music').
 * @returns model (Movie, Series, o Album).
 */
export function getItemModel(type: string) {
  switch (type) {
    case 'Movies':
      return MovieModel;
    case 'Series':
      return SeriesModel;
    case 'Shows':
      return SeriesModel;
    case 'Music':
      return AlbumModel;
    default:
      throw new Error(`Invalid item type provided: ${type}`);
  }
}

export function extractNameAndYear(source: string) {
  // Remove parentheses and extra spaces
  const cleanSource = source
    .replace(/[()]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Regex to get name and year
  const regex = /^(.*?)(?:[\s.-]*(\d{4}))?$/;
  const match = cleanSource.match(regex);

  let name = '';
  let year = '1';

  if (match) {
    name = match[1];
    year = match[2] || '1';
  } else {
    name = cleanSource;
  }

  // Clean and format the name
  name = name
    .replace(/[-_]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return [name, year];
}

/** Fields the user can lock: another title brings all of its own data */
const unlockedFields = (content: object) =>
  Object.fromEntries(
    Object.keys(content)
      .filter((key) => key.endsWith('Lock'))
      .map((key) => [key, false]),
  );

/** Tells the clients that data and images of a content changed, so they load them again */
function notifyContentReplaced() {
  notificationService.broadcast(JSON.stringify({ header: 'CONTENT_REPLACED' }));
}

export async function changeIdentificationShow(
  showId: string,
  newTheMovieDBID: number,
  newepisodeGroupId?: string,
) {
  const show = await useCases.getSeriesById().execute(showId);
  if (!show) return;

  const library = await useCases.getLibrary().execute(show.libraryId);
  if (!library) return;

  // Its seasons are deleted to be read again: without the files they would be lost
  if (!fileSystemService.existsSync(show.folder)) {
    logger.warn({ folder: show.folder }, 'The folder of the series is not available');
    return;
  }

  const isAnotherTitle = show.themdbId !== newTheMovieDBID;

  // Seasons and episodes are the ones of the previous identification. The series stays
  await useCases.deleteSeries().execute(show.id, { keepSeries: true });

  await useCases.updateSeries().execute(show.id, {
    ...(isAnotherTitle ? { ...unlockedFields(show), episodeGroupId: '' } : {}),
    ...(newepisodeGroupId ? { episodeGroupId: newepisodeGroupId } : {}),
    themdbId: newTheMovieDBID,
    // Set element loading to show in client
    analyzingFiles: true,
  });

  notificationService.mutateLibrary(library.id);
  notifyContentReplaced();

  try {
    // Read again: the files of the series are no longer analyzed
    const updated = await useCases.getLibrary().execute(library.id);
    if (updated) await useCases.scanSeries().execute(updated, show.folder);

    if (isAnotherTitle) await replaceSeriesImages(show.id);
  } finally {
    await useCases.updateSeries().execute(show.id, { analyzingFiles: false });
    notificationService.mutateLibrary(library.id);
    notifyContentReplaced();
  }
}

export async function changeIdentificationMovie(movieId: string, newTheMovieDBID: number) {
  const movie = await useCases.getMoviebyId().execute(movieId);

  if (!movie) return;

  const library = await useCases.getLibrary().execute(movie.libraryId);

  if (!library) return;

  const isAnotherTitle = movie.themdbId !== newTheMovieDBID;

  // Update TheMovieDB ID and save to DB
  if (isAnotherTitle) Object.assign(movie, unlockedFields(movie));
  movie.themdbId = newTheMovieDBID;
  await useCases.updateMovie().execute(movie.id, movie);

  // Notify client
  notificationService.mutateMovie(movie);
  notificationService.mutateLibrary(library.id);

  // Fetch and apply new metadata using the updated TMDB ID
  await useCases.refreshMovieMetadata().execute(movie.id);

  if (isAnotherTitle) await replaceImagesWithRemote('movie', movie.id);

  notificationService.mutateLibrary(library.id);
  notifyContentReplaced();
}

/** The first image in internet of each kind, which is the one metadata assign by default */
async function replaceImagesWithRemote(owner: 'movie' | 'series' | 'season', id: string) {
  const content = await findContent(owner, id);
  const first = (field: string) => (content[field] as string[] | undefined)?.[0];
  const changes = await artworkService.replaceWithRemote(owner, content, {
    coverSrc: first('coversUrls'),
    logoSrc: first('logosUrls'),
    backgroundSrc: first('backgroundsUrls'),
  });
  await saveContentFields(owner, id, changes);
}

async function replaceSeriesImages(seriesId: string) {
  await replaceImagesWithRemote('series', seriesId);
  const series = await useCases.getSeriesById().execute(seriesId, 'few');
  for (const season of series?.seasons ?? []) {
    await replaceImagesWithRemote('season', season.id);
  }
}
