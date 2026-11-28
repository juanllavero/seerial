import fs from 'node:fs';
import path from 'node:path';
import logger from '@/utils/logger';
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { CollectionModel } from '@/api/v1/collections/infrastructure/persistence/models/CollectionModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { PlayListModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import {
  BadRequestException,
  NotFoundException,
} from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import {
  ARTWORK_FIELDS,
  type ArtworkEntity,
  type ArtworkOwner,
  artworkService,
  toFilePath,
} from './ArtworkService';
import { findArtwork } from './artworkFiles';

/** Collections call `posterSrc` what clients receive as `coverSrc` */
const clientField = (owner: ArtworkOwner, field: string) =>
  owner === 'collection' && field === 'posterSrc' ? 'coverSrc' : field;

export const storedField = (owner: ArtworkOwner, field: string) =>
  owner === 'collection' && field === 'coverSrc' ? 'posterSrc' : field;

interface ContentModel {
  findOne(options: { where: { id: string } }): Promise<unknown>;
  update(id: string, changes: object): Promise<unknown>;
}

const modelOf = (owner: ArtworkOwner) => MODELS[owner] as unknown as ContentModel;

const MODELS = {
  movie: MovieModel,
  series: SeriesModel,
  season: SeasonModel,
  collection: CollectionModel,
  album: AlbumModel,
  playlist: PlayListModel,
};

export async function findContent(
  owner: ArtworkOwner,
  id: string,
): Promise<ArtworkEntity & Record<string, unknown>> {
  const content = await modelOf(owner).findOne({ where: { id } });
  if (!content) throw new NotFoundException(`${owner} ${id} not found`);

  return content as unknown as ArtworkEntity & Record<string, unknown>;
}

export async function saveContentFields(
  owner: ArtworkOwner,
  id: string,
  changes: object,
): Promise<void> {
  if (Object.keys(changes).length > 0) await modelOf(owner).update(id, changes);
}

/**
 * Images chosen by the user in an edit: saved in local, replacing the previous ones. Returns the
 * data to store, with the paths of the local files.
 */
export async function applyUserImages<T extends object>(
  owner: ArtworkOwner,
  id: string,
  data: T,
): Promise<T> {
  const values: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  if (owner === 'collection' && 'coverSrc' in values) {
    values.posterSrc = values.coverSrc;
    delete values.coverSrc;
  }

  // Most updates do not change images
  if (!Object.keys(ARTWORK_FIELDS[owner]).some((field) => values[field])) return values as T;

  const content = await findContent(owner, id);
  // The same image stored as an address or as a path is not a change
  const current: Record<string, unknown> = { ...content };
  for (const [field, value] of Object.entries(values)) {
    const before = current[field];
    if (typeof value === 'string' && typeof before === 'string') {
      if (toFilePath(value) === toFilePath(before)) current[field] = value;
    }
  }

  try {
    await artworkService.select(owner, content, current, values);
  } catch (error) {
    throw new BadRequestException(
      `The image could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return values as T;
}

/** Local images of a content, with the field names that clients use */
export async function getLocalImages(
  owner: ArtworkOwner,
  id: string,
): Promise<Record<string, string>> {
  const found = await artworkService.find(owner, await findContent(owner, id));
  return Object.fromEntries(
    Object.entries(found).map(([field, file]) => [clientField(owner, field), file]),
  );
}

/** Image uploaded (content) or downloaded (address) by the user for one field */
export async function setLocalImage(
  owner: ArtworkOwner,
  id: string,
  field: string,
  source: Buffer | string,
): Promise<string> {
  const content = await findContent(owner, id);
  const target = storedField(owner, field);

  let file: string;
  try {
    file = await artworkService.set(owner, content, target, source);
  } catch (error) {
    throw new BadRequestException(
      `The image could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await saveContentFields(owner, id, { [target]: file });
  return file;
}

/**
 * For scans: uses the local images of a content and saves in local the ones that only are in
 * internet. A failure here never stops a scan.
 */
export async function syncContentImages(owner: ArtworkOwner, id: string): Promise<void> {
  try {
    const content = await findContent(owner, id);
    await saveContentFields(owner, id, await artworkService.sync(owner, content));
  } catch (error) {
    logger.warn({ error, owner, id }, 'Failed to synchronize the local images');
  }
}

/**
 * For the end of a series scan, when all its seasons are known: the background of an only season
 * gets the simple name, which the seasons added later will also use.
 */
export async function simplifyOnlySeasonBackground(seriesId: string): Promise<void> {
  try {
    const seasons = await SeasonModel.find({ where: { seriesId } });
    if (seasons.length !== 1) return;

    const [season] = seasons;
    const location = await artworkService.locate('season', season);
    if (!location) return;

    const own = findArtwork(artworkService.slot(location, 'season', 'backgroundSrc'));
    const general = { folder: location.folder, name: 'background' };
    if (!own || findArtwork(general)) return;

    const destination = path.join(general.folder, `${general.name}${path.extname(own)}`);
    fs.renameSync(own, destination);
    await saveContentFields('season', season.id, { backgroundSrc: destination });
  } catch (error) {
    logger.warn({ error, seriesId }, 'Failed to rename the background of the season');
  }
}
