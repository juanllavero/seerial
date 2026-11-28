import fs from 'node:fs';
import path from 'node:path';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { fileSystemService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import logger from '@/utils/logger';
import { type ArtworkEntity, artworkService } from './ArtworkService';
import type { ArtworkSlot } from './artworkFiles';
import {
  findInSlot,
  temporaryStem,
  type ThemeKind,
  type ThemeOwner,
  themeMediaSlot,
} from './themeMedia';

const migrationLogger = logger.child({ category: 'Theme Migration' });

export interface ThemeMigrationReport {
  /** [from, to] */
  moved: [string, string][];
  /** Automatic downloads removed because the user already had a theme */
  removed: string[];
  /** Contents whose folder is not reachable: done in a later start */
  unreachable: number;
  failed: number;
}

interface Options {
  dryRun: boolean;
  report: ThemeMigrationReport;
}

const isInResources = (folder: string) => {
  const relative = path.relative(fileSystemService.getExternalPath('resources'), folder);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** Copies (the destination can be another drive), checks and only then removes the original */
function moveInto(slot: ArtworkSlot, source: string, { dryRun, report }: Options): void {
  const destination = path.join(slot.folder, `${slot.name}${path.extname(source).toLowerCase()}`);
  if (!dryRun) {
    fs.mkdirSync(slot.folder, { recursive: true });
    const temporaryFile = `${temporaryStem(slot)}${path.extname(source)}`;
    try {
      fs.copyFileSync(source, temporaryFile);
      if (fs.statSync(temporaryFile).size !== fs.statSync(source).size) {
        throw new Error(`Incomplete copy of ${source}`);
      }
      if (fs.existsSync(destination)) return;
      fs.renameSync(temporaryFile, destination);
    } finally {
      fs.rmSync(temporaryFile, { force: true });
    }
    fs.rmSync(source, { force: true });
  }

  report.moved.push([source, destination]);
}

const removeIfEmpty = (folder: string) => {
  if (fs.existsSync(folder) && fs.readdirSync(folder).length === 0) fs.rmdirSync(folder);
};

/** Song downloaded by the scans into resources/music/{id} */
async function migrateDownloadedSong(
  owner: ThemeOwner,
  entity: ArtworkEntity,
  options: Options,
): Promise<void> {
  const folder = fileSystemService.getExternalPath(
    path.join('resources', 'music', String(entity.id)),
  );
  const song = path.join(folder, `${entity.id}.opus`);
  if (!fs.existsSync(song)) return;

  const location = await artworkService.locate(owner, entity);
  if (!location) {
    options.report.unreachable++;
    return;
  }
  // Content that cannot have files next to it (a movie without folder): the song stays
  if (isInResources(location.folder)) return;

  const slot = { folder: location.folder, name: `${location.prefix}theme` };
  if (findInSlot(slot, 'theme')) {
    // The one of the user always wins
    if (!options.dryRun) fs.rmSync(song, { force: true });
    options.report.removed.push(song);
  } else {
    moveInto(slot, song, options);
  }
  if (!options.dryRun) removeIfEmpty(folder);
}

/** Files of the previous layout: media/theme.*, media/video.*, media/s1_theme.* */
async function migrateMediaFolder(
  owner: ThemeOwner,
  entity: ArtworkEntity,
  contentFolder: string,
  options: Options,
): Promise<void> {
  const media = path.join(contentFolder, 'media');
  const previousPrefix = owner === 'season' ? `s${entity.seasonNumber}_` : '';

  for (const kind of ['theme', 'video'] as ThemeKind[]) {
    const file = findInSlot({ folder: media, name: `${previousPrefix}${kind}` }, kind);
    if (!file) continue;

    const slot = await themeMediaSlot(owner, entity, kind);
    if (slot && !findInSlot(slot, kind)) moveInto(slot, file, options);
  }
}

/**
 * Moves the theme songs and background videos of previous layouts next to their content. Files the
 * user already has are never replaced. Safe to run on every start.
 * With `dryRun` nothing is written: only the report of what would be done.
 */
export async function migrateThemeMedia({ dryRun = false } = {}): Promise<ThemeMigrationReport> {
  const report: ThemeMigrationReport = { moved: [], removed: [], unreachable: 0, failed: 0 };
  const options = { dryRun, report };

  const attempt = async (id: string, migrate: () => Promise<void>) => {
    try {
      await migrate();
    } catch (error) {
      report.failed++;
      migrationLogger.warn(
        { error: error instanceof Error ? error.message : String(error), id },
        'Failed to migrate the theme',
      );
    }
  };

  for (const [owner, model] of [
    ['movie', MovieModel],
    ['series', SeriesModel],
  ] as const) {
    for (const content of await (model as typeof MovieModel).find()) {
      await attempt(content.id, async () => {
        await migrateDownloadedSong(owner, content, options);
        if (content.folder) await migrateMediaFolder(owner, content, content.folder, options);
      });
    }
  }

  for (const season of await SeasonModel.find()) {
    await attempt(season.id, async () => {
      const series = await SeriesModel.findOne({ where: { id: season.seriesId } });
      if (series?.folder) await migrateMediaFolder('season', season, series.folder, options);
    });
  }

  if (report.moved.length > 0 || report.removed.length > 0 || report.failed > 0) {
    migrationLogger.info(
      {
        moved: report.moved,
        removed: report.removed,
        unreachable: report.unreachable,
        failed: report.failed,
        dryRun,
      },
      'Themes migrated to the folders of their content',
    );
  }

  return report;
}
