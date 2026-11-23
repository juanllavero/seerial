import path from 'node:path';
import type { AudioInfo } from '@seerial/domain';
import type { FileSystemServicePort } from '@/api/v1/shared/application/ports/FileSystemServicePort';
import { getAudioInfo } from '@/api/v1/shared/infrastructure/adapters/ffmpeg/audioInfo';
import logger from '@/utils/logger';
import { getSongVariant } from '@/utils/songVariants';
import type { Song } from '../../domain/Song';
import type { SongsRepositoryPort } from '../ports/SongsRepositoryPort';

const syncLogger = logger.child({ category: 'Song File Sync' });

/** Files that accompany a song: `name.vocals.ext`, `name.inst.ext` and `name.atmos.ext`. */
export interface SongCompanions {
  vocals?: string;
  inst?: string;
  /** All `name.atmos.ext` candidates, as they still have to be verified to be Dolby Atmos. */
  atmos: string[];
}

type ReadAudioInfo = (filePath: string) => Promise<AudioInfo | undefined>;

/**
 * Keeps the file-derived data of a song up to date: Dolby Atmos flag, Atmos version,
 * and vocals/instrumental stems. Companion files are never created as songs.
 */
export class SongFileSyncService {
  constructor(
    private readonly fileSystemService: FileSystemServicePort,
    private readonly songsRepo: SongsRepositoryPort,
    private readonly readAudioInfo: ReadAudioInfo = getAudioInfo,
  ) {}

  /**
   * Finds the companion files of the given songs by listing their folders.
   * Companions are matched by file name (case-insensitive) in the same folder.
   */
  async findCompanions(musicFiles: string[]): Promise<Map<string, SongCompanions>> {
    const companionsByFolder = new Map<string, Map<string, SongCompanions>>();

    for (const folder of new Set(musicFiles.map((file) => path.dirname(file)))) {
      companionsByFolder.set(folder, await this.listFolderCompanions(folder));
    }

    const result = new Map<string, SongCompanions>();
    for (const musicFile of musicFiles) {
      const key = path.parse(musicFile).name.toLowerCase();
      const companions = companionsByFolder.get(path.dirname(musicFile))?.get(key);
      if (companions) result.set(musicFile, companions);
    }

    return result;
  }

  /**
   * Creates the song when it does not exist (using `buildNewSong` for its base data),
   * or refreshes its file-derived data when it changed. Returns null if it can't be read.
   */
  async sync(
    musicFile: string,
    companions: SongCompanions | undefined,
    buildNewSong: (info: AudioInfo) => Partial<Song>,
  ): Promise<Song | null> {
    const existing = await this.songsRepo.findByPath(musicFile);
    const stats = await this.fileSystemService.getFileStats(musicFile);
    const modifiedAt = stats ? Math.floor(stats.mtimeMs) : null;

    if (!existing) {
      return this.createSong(musicFile, companions, modifiedAt, buildNewSong);
    }

    if (!existing.id) return existing;

    const patch = await this.buildRefreshPatch(existing, musicFile, companions, modifiedAt);
    if (Object.keys(patch).length === 0) return existing;

    syncLogger.debug({ musicFile, patch }, 'Refreshing song file data');
    return { ...existing, ...(await this.songsRepo.update(existing.id, patch)) };
  }

  private async createSong(
    musicFile: string,
    companions: SongCompanions | undefined,
    modifiedAt: number | null,
    buildNewSong: (info: AudioInfo) => Partial<Song>,
  ): Promise<Song | null> {
    const info = await this.readAudioInfo(musicFile);
    if (!info) return null;

    const atmosFileSrc = info.hasDolbyAtmos ? null : await this.findAtmosVersion(companions);

    return this.songsRepo.create({
      ...buildNewSong(info),
      fileSrc: musicFile,
      hasDolbyAtmos: info.hasDolbyAtmos || !!atmosFileSrc,
      atmosFileSrc,
      vocalsFileSrc: companions?.vocals ?? null,
      instrumentalFileSrc: companions?.inst ?? null,
      fileModifiedAt: modifiedAt,
    });
  }

  private async buildRefreshPatch(
    song: Song,
    musicFile: string,
    companions: SongCompanions | undefined,
    modifiedAt: number | null,
  ): Promise<Partial<Song>> {
    const patch: Partial<Song> = {};

    // Songs analyzed before the file time was tracked are always re-analyzed once
    const wasAnalyzed = song.fileModifiedAt !== null && song.fileModifiedAt !== undefined;
    const fileChanged = modifiedAt !== null && song.fileModifiedAt !== modifiedAt;
    let originalIsAtmos = song.hasDolbyAtmos === true && !song.atmosFileSrc;

    if (fileChanged || !wasAnalyzed) {
      const info = await this.readAudioInfo(musicFile);

      if (info) {
        originalIsAtmos = info.hasDolbyAtmos;
        if (info.codec !== song.codec) patch.codec = info.codec;
        if (info.duration && info.duration * 60 !== song.duration) {
          patch.duration = info.duration * 60;
        }
      }

      if (modifiedAt !== null) patch.fileModifiedAt = modifiedAt;
    }

    const atmosFileSrc = originalIsAtmos
      ? null
      : await this.findAtmosVersion(companions, song.atmosFileSrc);
    const hasDolbyAtmos = originalIsAtmos || !!atmosFileSrc;
    const vocalsFileSrc = companions?.vocals ?? null;
    const instrumentalFileSrc = companions?.inst ?? null;

    if (song.hasDolbyAtmos !== hasDolbyAtmos) patch.hasDolbyAtmos = hasDolbyAtmos;
    if ((song.atmosFileSrc ?? null) !== atmosFileSrc) patch.atmosFileSrc = atmosFileSrc;
    if ((song.vocalsFileSrc ?? null) !== vocalsFileSrc) patch.vocalsFileSrc = vocalsFileSrc;
    if ((song.instrumentalFileSrc ?? null) !== instrumentalFileSrc) {
      patch.instrumentalFileSrc = instrumentalFileSrc;
    }

    return patch;
  }

  /**
   * Returns the first `.atmos` companion that really is Dolby Atmos.
   * The currently registered one is trusted while it still exists, to avoid re-probing it on every scan.
   */
  private async findAtmosVersion(
    companions: SongCompanions | undefined,
    current?: string | null,
  ): Promise<string | null> {
    const candidates = companions?.atmos ?? [];

    if (current && candidates.includes(current)) return current;

    for (const candidate of candidates) {
      const info = await this.readAudioInfo(candidate);
      if (info?.hasDolbyAtmos) return candidate;

      syncLogger.info({ candidate }, 'Ignoring .atmos file that is not Dolby Atmos');
    }

    return null;
  }

  private async listFolderCompanions(folder: string): Promise<Map<string, SongCompanions>> {
    const companionsByName = new Map<string, SongCompanions>();
    const entries = await this.fileSystemService.getFilesInFolder(folder);

    const names = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const name of names) {
      const filePath = path.join(folder, name);
      const variant = getSongVariant(filePath);
      if (!variant || !this.fileSystemService.isAudioFile(filePath)) continue;

      const key = variant.baseName.toLowerCase();
      const companions = companionsByName.get(key) ?? { atmos: [] };

      if (variant.kind === 'atmos') companions.atmos.push(filePath);
      else if (variant.kind === 'vocals') companions.vocals ??= filePath;
      else companions.inst ??= filePath;

      companionsByName.set(key, companions);
    }

    return companionsByName;
  }
}
