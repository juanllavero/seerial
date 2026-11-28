import fs from 'node:fs';
import path from 'node:path';
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { CollectionModel } from '@/api/v1/collections/infrastructure/persistence/models/CollectionModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { PlayListModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import logger from '@/utils/logger';
import { ARTWORK_FIELDS, type ArtworkOwner, artworkService } from './ArtworkService';
import { ARTWORK_EXTENSIONS, findArtwork, storeArtworkFile } from './artworkFiles';
import { findContent, saveContentFields } from './contentArtwork';

const migrationLogger = logger.child({ category: 'Artwork Migration' });

export interface ArtworkMigrationReport {
  /** Files copied to their new place: [from, to] */
  copied: [string, string][];
  /** Contents whose stored path changes */
  updated: number;
  /** Files of media folders removed after being copied */
  removed: string[];
  /** Contents whose folder is not reachable: done in a later start */
  unreachable: number;
  failed: number;
}

const OWNERS = {
  movie: MovieModel,
  series: SeriesModel,
  season: SeasonModel,
  collection: CollectionModel,
  album: AlbumModel,
  playlist: PlayListModel,
};

const isMediaFile = (file: string) => path.basename(path.dirname(file)).toLowerCase() === 'media';

/** Image of the previous layout: media/poster.jpg, media/s1_background.jpg */
function previousNamedFile(
  owner: ArtworkOwner,
  contentFolder: string,
  field: string,
  seasonNumber: number | undefined,
): string | null {
  const name = ARTWORK_FIELDS[owner][field];
  const stem = owner === 'season' ? `s${seasonNumber}_${name}` : name;
  return findArtwork({ folder: path.join(contentFolder, 'media'), name: stem });
}

/**
 * Moves the images of the previous layout (media folders and folders of the application) to the
 * current one. Safe to run on every start: once done there is nothing left to do.
 * With `dryRun` nothing is written: only the report of what would be done.
 */
export async function migrateArtwork({ dryRun = false } = {}): Promise<ArtworkMigrationReport> {
  const report: ArtworkMigrationReport = {
    copied: [],
    updated: 0,
    removed: [],
    unreachable: 0,
    failed: 0,
  };
  const moved = new Set<string>();
  /** Destinations already planned, which a dry run does not create */
  const planned = new Set<string>();

  for (const [owner, model] of Object.entries(OWNERS) as [ArtworkOwner, typeof MovieModel][]) {
    const contents = await (model as unknown as typeof MovieModel).find({ select: { id: true } });

    for (const { id } of contents) {
      try {
        const content = await findContent(owner, id);
        const location = await artworkService.locate(owner, content);
        if (!location) {
          report.unreachable++;
          continue;
        }

        // Folder where the previous layout kept the media folder
        const contentFolder = owner === 'season' ? location.folder : (content.folder as string);
        const changes: Record<string, string> = {};

        for (const field of Object.keys(ARTWORK_FIELDS[owner])) {
          const slot = artworkService.slot(location, owner, field);
          const value = content[field] as string | undefined;
          const current = value ? artworkService.resolveFile(value) : null;
          const stored = current && artworkService.isManagedFile(current) ? current : null;
          let local = artworkService.findLocal(location, owner, field);

          if (!local) {
            const source =
              stored ??
              (contentFolder
                ? previousNamedFile(owner, contentFolder, field, content.seasonNumber)
                : null);
            if (!source || !ARTWORK_EXTENSIONS.includes(path.extname(source).toLowerCase())) {
              continue;
            }

            local = path.join(slot.folder, `${slot.name}${path.extname(source).toLowerCase()}`);
            if (!planned.has(local)) {
              if (!dryRun) local = storeArtworkFile(slot, source);
              planned.add(local);
              report.copied.push([source, local]);
              if (isMediaFile(source)) moved.add(source);
            }
          }

          // A remote address is replaced only by a file that was already there for this content
          if (local !== value) changes[field] = local;
        }

        if (Object.keys(changes).length > 0) {
          report.updated++;
          if (!dryRun) await saveContentFields(owner, id, changes);
        }
      } catch (error) {
        report.failed++;
        migrationLogger.warn(
          { error: error instanceof Error ? error.message : String(error), owner, id },
          'Failed to migrate the images',
        );
      }
    }
  }

  // Originals are removed at the end: two contents could use the same file
  const inUse = new Set<string>();
  if (!dryRun) {
    for (const [owner, model] of Object.entries(OWNERS) as [ArtworkOwner, typeof MovieModel][]) {
      for (const content of await (model as unknown as typeof MovieModel).find()) {
        for (const field of Object.keys(ARTWORK_FIELDS[owner])) {
          const value = (content as unknown as Record<string, string>)[field];
          const file = value ? artworkService.resolveFile(value) : null;
          if (file) inUse.add(path.resolve(file).toLowerCase());
        }
      }
    }
  }

  for (const file of moved) {
    if (inUse.has(path.resolve(file).toLowerCase())) continue;
    if (!dryRun) fs.rmSync(file, { force: true });
    report.removed.push(file);
  }

  if (report.copied.length > 0 || report.failed > 0) {
    migrationLogger.info(
      {
        copied: report.copied,
        removed: report.removed.length,
        updated: report.updated,
        unreachable: report.unreachable,
        failed: report.failed,
        dryRun,
      },
      'Images migrated to the folders of their content',
    );
  }

  return report;
}
