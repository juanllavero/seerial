import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { fileSystemService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { downloadImage, isRemoteUrl } from '@/utils/downloadImage';
import logger from '@/utils/logger';
import {
  type ArtworkSlot,
  findArtwork,
  storeArtworkBuffer,
  storeArtworkFile,
  temporaryArtworkPath,
  commitArtwork,
} from './artworkFiles';

const artworkLogger = logger.child({ category: 'Artwork' });

export type ArtworkOwner = 'movie' | 'series' | 'season' | 'collection' | 'album' | 'playlist';

/** Image fields of each content, with the name of the file that stores each one */
export const ARTWORK_FIELDS: Record<ArtworkOwner, Record<string, string>> = {
  movie: { coverSrc: 'poster', logoSrc: 'logo', backgroundSrc: 'background' },
  series: { coverSrc: 'poster', logoSrc: 'logo' },
  season: { backgroundSrc: 'background' },
  collection: { posterSrc: 'poster', backgroundSrc: 'background' },
  album: { coverSrc: 'cover' },
  playlist: { coverSrc: 'cover' },
};

/** The data of a content needed to know where its images go */
export interface ArtworkEntity {
  id: string;
  folder?: string | null;
  seriesId?: string;
  seasonNumber?: number;
  /**
   * For collections with video and music, which live in different folders: whose folder to use.
   * The video one when not given (or the music one if there is no video).
   */
  kind?: 'video' | 'music';
}

export interface ArtworkLocation {
  folder: string;
  /** season01- for the images of a season, which live in the folder of the series */
  prefix: string;
}

const comparable = (value: string) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const isInside = (child: string, parent: string) => {
  const relative = path.relative(comparable(parent), comparable(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const statOf = (value: string) => {
  try {
    return fs.statSync(value);
  } catch {
    return null;
  }
};

/** Images selected from a local folder used to be stored as the address that serves them */
export function toFilePath(value: string): string {
  const address = /^(?:\/api\/)?images\/local\?path=([^&]+)/.exec(value);
  return address ? decodeURIComponent(address[1]) : value;
}

export class ArtworkService {
  /** Folder of the application for the content that cannot have its images next to it */
  private appFolder(key: string): ArtworkLocation {
    return { folder: fileSystemService.getExternalPath(`resources/img/artwork/${key}`), prefix: '' };
  }

  private hashKey(owner: ArtworkOwner, value: string): string {
    return `${owner}-${createHash('sha1').update(comparable(value)).digest('hex').slice(0, 16)}`;
  }

  private async libraryRoots(): Promise<Set<string>> {
    const libraries = await LibraryModel.find({ select: { id: true, folders: true } });
    return new Set(libraries.flatMap((library) => library.folders ?? []).map(comparable));
  }

  /**
   * Folder of the images of a content. Null when it cannot be known because the content is not
   * reachable (a disconnected drive): nothing must be read, written or moved then.
   */
  async locate(owner: ArtworkOwner, entity: ArtworkEntity): Promise<ArtworkLocation | null> {
    if (owner === 'collection') return this.locateCollection(entity.id, entity.kind);

    if (owner === 'season') {
      const series = await SeriesModel.findOne({ where: { id: entity.seriesId } });
      if (!series?.folder || !statOf(series.folder)?.isDirectory()) return null;
      const number = String(entity.seasonNumber ?? 0).padStart(2, '0');
      return { folder: series.folder, prefix: `season${number}-` };
    }

    if (!entity.folder) return owner === 'playlist' ? this.appFolder(`playlist-${entity.id}`) : null;

    const stats = statOf(entity.folder);
    if (!stats) return null;

    // A movie that is a file on its own has no folder: its images stay in the application.
    // The key comes from the path, so they are found again if the movie is removed and re-added.
    if (!stats.isDirectory()) return this.appFolder(this.hashKey(owner, entity.folder));

    const shared =
      (await this.libraryRoots()).has(comparable(entity.folder)) ||
      (await this.isFolderShared(owner, entity));
    if (shared) {
      return this.appFolder(
        owner === 'playlist' ? `playlist-${entity.id}` : this.hashKey(owner, entity.folder),
      );
    }

    return { folder: entity.folder, prefix: '' };
  }

  /** Albums and playlists use cover.* : two of them cannot keep it in the same folder */
  private async isFolderShared(owner: ArtworkOwner, entity: ArtworkEntity): Promise<boolean> {
    if (owner !== 'album' && owner !== 'playlist') return false;

    const albums = await AlbumModel.find({ select: { id: true, folder: true } });
    const folder = comparable(entity.folder as string);
    return albums.some(
      (album) =>
        album.folder &&
        comparable(album.folder) === folder &&
        (owner === 'playlist' || album.id !== entity.id),
    );
  }

  /**
   * A collection keeps its images in a folder only when that folder is its own: all its items are
   * directly inside it, nothing else is, and it is not a folder of a library.
   */
  private async locateCollection(id: string, kind?: ArtworkEntity['kind']): Promise<ArtworkLocation | null> {
    const fallback = this.appFolder(`collection-${id}`);
    const parent = await this.collectionParent(id, kind);
    if (!parent) return fallback;

    const select = { id: true, folder: true, collectionId: true } as const;
    const others = (
      await Promise.all([
        MovieModel.find({ select }),
        SeriesModel.find({ select }),
        AlbumModel.find({ select }),
      ])
    )
      .flat()
      .filter((item) => item.folder && item.collectionId !== id);
    if (others.some((item) => isInside(item.folder, parent))) return fallback;

    return statOf(parent)?.isDirectory() ? { folder: parent, prefix: '' } : null;
  }

  /**
   * The deepest folder that holds all the items of a collection (they can be in subfolders), if it
   * is inside a library and is not the folder of the library itself.
   */
  private async collectionParent(id: string, kind?: ArtworkEntity['kind']): Promise<string | null> {
    const options = { where: { collectionId: id }, select: { id: true, folder: true } };
    const [movies, series, albums] = await Promise.all([
      MovieModel.find(options),
      SeriesModel.find(options),
      AlbumModel.find(options),
    ]);
    const video = [...movies, ...series].filter((item) => item.folder);
    const music = albums.filter((item) => item.folder);
    const members = kind === 'music' || (!kind && video.length === 0) ? music : video;
    if (members.length === 0) return null;

    let parent = path.dirname(path.resolve(members[0].folder));
    for (const { folder } of members) {
      while (!isInside(folder, parent) && path.dirname(parent) !== parent) {
        parent = path.dirname(parent);
      }
    }

    const roots = [...(await this.libraryRoots())];
    const isLibraryFolder = roots.includes(comparable(parent));
    return !isLibraryFolder && roots.some((root) => isInside(parent, root)) ? parent : null;
  }

  /**
   * Whether a collection may have local images. Cheap check for the listings, which avoids looking
   * for the items of other collections for the ones without images.
   */
  private async mayHaveImages(id: string, kind?: ArtworkEntity['kind']): Promise<boolean> {
    const folders = [this.appFolder(`collection-${id}`).folder, await this.collectionParent(id, kind)];
    return folders.some(
      (folder) =>
        folder &&
        Object.values(ARTWORK_FIELDS.collection).some((name) => findArtwork({ folder, name })),
    );
  }

  slot(location: ArtworkLocation, owner: ArtworkOwner, field: string): ArtworkSlot {
    return { folder: location.folder, name: `${location.prefix}${ARTWORK_FIELDS[owner][field]}` };
  }

  /** Image that a content uses: a season without its own one uses the general one of the series */
  findLocal(location: ArtworkLocation, owner: ArtworkOwner, field: string): string | null {
    return (
      findArtwork(this.slot(location, owner, field)) ??
      (location.prefix
        ? findArtwork({ folder: location.folder, name: ARTWORK_FIELDS[owner][field] })
        : null)
    );
  }

  /**
   * Where a file chosen for a content is saved, given its simple name (background, theme, video).
   * A season keeps its own file when it has one. Otherwise it uses the simple name if there is no
   * general file yet or it is the only season, and season01-name in other case.
   */
  async writeSlot(
    location: ArtworkLocation,
    owner: ArtworkOwner,
    entity: ArtworkEntity,
    name: string,
    exists: (slot: ArtworkSlot) => boolean,
  ): Promise<ArtworkSlot> {
    const own = { folder: location.folder, name: `${location.prefix}${name}` };
    if (owner !== 'season' || exists(own)) return own;

    const general = { folder: location.folder, name };
    if (!exists(general)) return general;

    const seasons = await SeasonModel.find({ where: { seriesId: entity.seriesId } });
    return seasons.length > 1 ? own : general;
  }

  /** Slot of an image chosen by the user */
  private chosenSlot(
    location: ArtworkLocation,
    owner: ArtworkOwner,
    entity: ArtworkEntity,
    field: string,
  ): Promise<ArtworkSlot> {
    return this.writeSlot(location, owner, entity, ARTWORK_FIELDS[owner][field], (slot) =>
      Boolean(findArtwork(slot)),
    );
  }

  /** Local images of a content, by field */
  async find(owner: ArtworkOwner, entity: ArtworkEntity): Promise<Record<string, string>> {
    if (owner === 'collection' && !(await this.mayHaveImages(entity.id, entity.kind))) return {};
    const location = await this.locate(owner, entity);
    const found: Record<string, string> = {};
    if (!location) return found;

    for (const field of Object.keys(ARTWORK_FIELDS[owner])) {
      const file = this.findLocal(location, owner, field);
      if (file) found[field] = file;
    }

    return found;
  }

  /** Downloads a remote image into its slot, replacing the one there only if the download works */
  async download(slot: ArtworkSlot, url: string): Promise<string> {
    fs.mkdirSync(slot.folder, { recursive: true });
    const temporaryFile = temporaryArtworkPath(slot);
    try {
      await downloadImage(url, temporaryFile);
      return commitArtwork(slot, temporaryFile);
    } finally {
      fs.rmSync(temporaryFile, { force: true });
    }
  }

  /** Existing file referred by a stored value, or null */
  resolveFile(value: string): string | null {
    const filePath = toFilePath(value);
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : fileSystemService.getExternalPath(filePath);
    return statOf(absolute)?.isFile() ? absolute : null;
  }

  /** Whether a file is one the application stored (or used to store) for a content */
  isManagedFile(file: string): boolean {
    return (
      isInside(file, fileSystemService.getExternalPath('resources')) ||
      path.basename(path.dirname(file)).toLowerCase() === 'media'
    );
  }

  /**
   * Used by scans and metadata refreshes: what the user has in local always wins over internet,
   * and what only is in internet is saved in local. Never replaces a local image.
   * Changes the entity and returns the changed fields, to be saved by the caller.
   */
  async sync<T extends ArtworkEntity>(owner: ArtworkOwner, entity: T): Promise<Partial<T>> {
    const changes: Record<string, string> = {};
    let location: ArtworkLocation | null = null;
    try {
      location = await this.locate(owner, entity);
    } catch (error) {
      artworkLogger.error({ error, owner, id: entity.id }, 'Failed to locate the images');
    }
    if (!location) return changes as Partial<T>;

    const values = entity as unknown as Record<string, string | undefined>;
    for (const field of Object.keys(ARTWORK_FIELDS[owner])) {
      const slot = this.slot(location, owner, field);
      const value = values[field];
      try {
        let local = this.findLocal(location, owner, field);
        if (!local && value) {
          if (isRemoteUrl(value)) {
            local = await this.download(slot, value);
          } else {
            const file = this.resolveFile(value);
            if (file && this.isManagedFile(file)) local = storeArtworkFile(slot, file);
          }
        }
        if (local && local !== value) {
          values[field] = local;
          changes[field] = local;
        }
      } catch (error) {
        artworkLogger.warn(
          { error: error instanceof Error ? error.message : String(error), owner, field, value },
          'Failed to save the image in local, keeping the current one',
        );
      }
    }

    return changes as Partial<T>;
  }

  /**
   * Images chosen by the user in an edit: they replace the local ones. `current` are the values
   * before the edit; unchanged fields are left alone. Changes `data`.
   * Throws, without touching the previous image, when a chosen one cannot be saved.
   */
  async select(
    owner: ArtworkOwner,
    entity: ArtworkEntity,
    current: object,
    data: object,
  ): Promise<void> {
    const before = current as Record<string, string | undefined>;
    const values = data as Record<string, string | undefined>;
    const changed = Object.keys(ARTWORK_FIELDS[owner]).filter(
      (field) => values[field] && values[field] !== before[field],
    );
    if (changed.length === 0) return;

    const location = await this.locate(owner, entity);
    if (!location) throw new Error('The folder of this content is not available');

    for (const field of changed) {
      values[field] = await this.store(
        await this.chosenSlot(location, owner, entity, field),
        values[field] as string,
      );
    }
  }

  /** Saves an image given by address or path into a slot, and returns the path of the file */
  private async store(slot: ArtworkSlot, value: string): Promise<string> {
    if (isRemoteUrl(value)) return this.download(slot, value);

    const file = this.resolveFile(value);
    if (!file) throw new Error(`Image not found: ${value}`);

    const current = findArtwork(slot);
    return current && comparable(current) === comparable(file)
      ? current
      : storeArtworkFile(slot, file);
  }

  /** Image uploaded or downloaded by the user for one field */
  async set(
    owner: ArtworkOwner,
    entity: ArtworkEntity,
    field: string,
    source: Buffer | string,
  ): Promise<string> {
    if (!ARTWORK_FIELDS[owner][field]) throw new Error(`${owner} has no ${field} image`);
    const location = await this.locate(owner, entity);
    if (!location) throw new Error('The folder of this content is not available');

    const slot = await this.chosenSlot(location, owner, entity, field);
    return Buffer.isBuffer(source)
      ? storeArtworkBuffer(slot, source)
      : this.download(slot, source);
  }

  /**
   * The content has been identified as another title: the images of the new one replace the local
   * ones. A previous image stays when the new one cannot be downloaded.
   */
  async replaceWithRemote<T extends ArtworkEntity>(
    owner: ArtworkOwner,
    entity: T,
    remote: Record<string, string | undefined>,
  ): Promise<Partial<T>> {
    const changes: Record<string, string> = {};
    for (const field of Object.keys(ARTWORK_FIELDS[owner])) {
      const url = remote[field];
      if (!url || !isRemoteUrl(url)) continue;
      try {
        changes[field] = await this.set(owner, entity, field, url);
        (entity as unknown as Record<string, string>)[field] = changes[field];
      } catch (error) {
        artworkLogger.warn({ error, owner, field, url }, 'Failed to replace the image');
      }
    }

    return changes as Partial<T>;
  }

  /**
   * Removes the images kept in the application for a content that is deleted. Only for the ones
   * identified by id: the images next to the content are never removed.
   */
  removeAppImages(owner: 'collection' | 'playlist', id: string): void {
    fileSystemService.deleteFolder(this.appFolder(`${owner}-${id}`).folder);
  }
}

export const artworkService = new ArtworkService();
