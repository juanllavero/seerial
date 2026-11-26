import { syncContentImages } from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import path from 'node:path';
import type { LibrariesRepositoryPort } from '@/api/v1/libraries/application/ports/LibrariesRepositoryPort';
import type { Library } from '@/api/v1/libraries/domain/Library';
import type { FileSystemServicePort } from '@/api/v1/shared/application/ports/FileSystemServicePort';
import type { NotificationServicePort } from '@/api/v1/shared/application/ports/NotificationServicePort';
import type { SongsRepositoryPort } from '@/api/v1/songs/application/ports/SongsRepositoryPort';
import { type SongCompanions, SongFileSyncService } from '@/api/v1/songs/application/services/SongFileSyncService';
import logger from '@/utils/logger';
import type { PlayList } from '../../domain/PlayList';
import type { PlayListRepositoryPort } from '../ports/PlayListRepositoryPort';

const playlistLogger = logger.child({ category: 'Playlist Scan' });

/**
 * Registers every folder with audio files found directly inside a library "Playlists" folder
 * as a playlist. Songs of the folder (including its sub-folders) are stored without an album
 * and linked to the playlist; songs referenced from elsewhere are left untouched.
 */
export class ScanPlayListFoldersUseCase {
  private readonly songFileSync: SongFileSyncService;

  constructor(
    private readonly fileSystemService: FileSystemServicePort,
    private readonly librariesRepo: LibrariesRepositoryPort,
    private readonly playlistRepo: PlayListRepositoryPort,
    songsRepo: SongsRepositoryPort,
    private readonly notificationService: NotificationServicePort,
  ) {
    this.songFileSync = new SongFileSyncService(fileSystemService, songsRepo);
  }

  async execute(library: Library, playlistsRoot: string): Promise<void> {
    if (!(await this.fileSystemService.isFolder(playlistsRoot))) {
      playlistLogger.warn({ playlistsRoot }, 'Playlists root is not a folder');
      return;
    }

    playlistLogger.info({ libraryId: library.id, playlistsRoot }, 'Starting playlists scan');

    const entries = await this.fileSystemService.getFilesInFolder(playlistsRoot);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        await this.processPlayListFolder(library, path.join(playlistsRoot, entry.name));
      } catch (error) {
        playlistLogger.error({ error, folder: entry.name }, 'Error processing playlist folder');
      }
    }

    this.notificationService.mutateLibrary(library.id);
  }

  private async processPlayListFolder(library: Library, folder: string): Promise<void> {
    const musicFiles = await this.fileSystemService.getValidMusicFiles(folder);
    if (musicFiles.length === 0) return;

    const playList = await this.getOrCreatePlayList(library, folder);
    // A cover.* in the folder of the playlist is its cover
    await syncContentImages('playlist', playList.id);
    const companions = await this.songFileSync.findCompanions(musicFiles);

    for (const musicFile of musicFiles) {
      await this.processSong(library, playList, musicFile, companions.get(musicFile));
    }
  }

  private async getOrCreatePlayList(library: Library, folder: string): Promise<PlayList> {
    const existing = await this.playlistRepo.findByFolder(folder);
    if (existing) return existing;

    playlistLogger.info({ folder }, 'Creating playlist from folder');

    return this.playlistRepo.create({
      id: '',
      title: path.basename(folder),
      libraryId: library.id,
      folder,
    });
  }

  private async processSong(
    library: Library,
    playList: PlayList,
    musicFile: string,
    companions?: SongCompanions,
  ): Promise<void> {
    try {
      const song = await this.songFileSync.sync(musicFile, companions, (metadata) => ({
        title: metadata.title || path.parse(musicFile).name,
        trackNumber: metadata.trackNumber || 0,
        discNumber: metadata.discNumber || 1,
        composers: metadata.composers || [],
        artists: metadata.artists || [],
        duration: metadata.duration ? metadata.duration * 60 : 0,
        codec: metadata.codec || '',
      }));

      if (!song?.id) {
        playlistLogger.error({ musicFile }, 'Failed to create song');
        return;
      }

      await this.playlistRepo.addSongToPlaylist(playList.id, song.id);

      if (library.analyzedFiles[musicFile] !== song.id) {
        library.analyzedFiles = { ...library.analyzedFiles, [musicFile]: song.id };
        await this.librariesRepo.addAnalyzedFile(library.id, musicFile, song.id);
      }
    } catch (error) {
      playlistLogger.error({ error, musicFile }, 'Error processing playlist song');
    }
  }
}
