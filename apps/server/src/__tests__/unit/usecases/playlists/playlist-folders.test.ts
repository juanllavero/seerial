import path from 'node:path';
import type { LibrariesRepositoryPort } from '@/api/v1/libraries/application/ports/LibrariesRepositoryPort';
import type { Library } from '@/api/v1/libraries/domain/Library';
import type { PlayListRepositoryPort } from '@/api/v1/playlists/application/ports/PlayListRepositoryPort';
import { DeletePlayListUseCase } from '@/api/v1/playlists/application/usecases/DeletePlayListUseCase';
import { RemoveFolderPlayListUseCase } from '@/api/v1/playlists/application/usecases/RemoveFolderPlayListUseCase';
import { RemoveSongFromPlayListUseCase } from '@/api/v1/playlists/application/usecases/RemoveSongFromPlayListUseCase';
import { ScanPlayListFoldersUseCase } from '@/api/v1/playlists/application/usecases/ScanPlayListFoldersUseCase';
import {
  isPathInsideFolder,
  isPlaylistsFolderName,
} from '@/api/v1/playlists/domain/PlayListFolder';
import type { FileSystemServicePort } from '@/api/v1/shared/application/ports/FileSystemServicePort';
import type { NotificationServicePort } from '@/api/v1/shared/application/ports/NotificationServicePort';
import { getAudioInfo } from '@/api/v1/shared/infrastructure/adapters/ffmpeg/audioInfo';
import type { SongsRepositoryPort } from '@/api/v1/songs/application/ports/SongsRepositoryPort';
import { DeleteSongUseCase } from '@/api/v1/songs/application/usecases/DeleteSongUseCase';

jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/audioInfo', () => ({
  getAudioInfo: jest.fn(),
}));

const root = path.join('music', 'Playlists');
const folder2000s = path.join(root, '2000s');

function dir(name: string) {
  return { name, isDirectory: () => true, isFile: () => false };
}

function buildLibrary(): Library {
  return {
    id: 'lib-1',
    type: 'Music',
    analyzedFiles: {},
    folders: ['music'],
  } as unknown as Library;
}

function build() {
  const fileSystem = {
    isFolder: jest.fn().mockResolvedValue(true),
    getFilesInFolder: jest.fn().mockResolvedValue([dir('2000s'), dir('Empty')]),
    getFileStats: jest.fn().mockResolvedValue({ mtimeMs: 1000 }),
    isAudioFile: jest.fn().mockReturnValue(true),
    getValidMusicFiles: jest
      .fn()
      .mockImplementation(async (folder: string) =>
        folder === folder2000s
          ? [path.join(folder2000s, 'a.mp3'), path.join(folder2000s, 'sub', 'b.mp3')]
          : [],
      ),
  };
  const librariesRepo = { addAnalyzedFile: jest.fn() };
  const playlistRepo = {
    findById: jest.fn(),
    findByFolder: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'pl-1', title: '2000s' }),
    addSongToPlaylist: jest.fn(),
    removeSongFromPlaylist: jest.fn(),
    delete: jest.fn(),
  };
  const songsRepo = {
    findById: jest.fn(),
    findByPath: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (song: { fileSrc: string }) => ({
      ...song,
      id: `song-${path.basename(song.fileSrc)}`,
    })),
    findWithoutAlbum: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
  };
  const notifications = { mutateLibrary: jest.fn() };

  const useCase = new ScanPlayListFoldersUseCase(
    fileSystem as unknown as FileSystemServicePort,
    librariesRepo as unknown as LibrariesRepositoryPort,
    playlistRepo as unknown as PlayListRepositoryPort,
    songsRepo as unknown as SongsRepositoryPort,
    notifications as unknown as NotificationServicePort,
  );

  return { fileSystem, librariesRepo, playlistRepo, songsRepo, useCase };
}

describe('Playlist folders', () => {
  beforeEach(() => {
    (getAudioInfo as jest.Mock).mockResolvedValue({
      title: 'Track',
      duration: 2,
      codec: 'mp3',
      hasDolbyAtmos: false,
    });
  });

  it('recognizes the Playlists folder name case-insensitively', () => {
    expect(isPlaylistsFolderName('Playlists')).toBe(true);
    expect(isPlaylistsFolderName('playlists')).toBe(true);
    expect(isPlaylistsFolderName('Albums')).toBe(false);
  });

  it('matches paths inside a folder regardless of separators and case', () => {
    expect(
      isPathInsideFolder('C:\\Music\\Playlists\\2000s\\a.mp3', 'c:/music/playlists/2000s'),
    ).toBe(true);
    expect(
      isPathInsideFolder('C:\\Music\\Playlists\\2000s2\\a.mp3', 'C:\\Music\\Playlists\\2000s'),
    ).toBe(false);
  });

  describe('ScanPlayListFoldersUseCase', () => {
    it('creates a library playlist from a folder and stores its songs without album', async () => {
      const { useCase, playlistRepo, songsRepo, librariesRepo } = build();
      const library = buildLibrary();

      await useCase.execute(library, root);

      expect(playlistRepo.create).toHaveBeenCalledTimes(1);
      expect(playlistRepo.create).toHaveBeenCalledWith({
        id: '',
        title: '2000s',
        libraryId: 'lib-1',
        folder: folder2000s,
      });
      expect(songsRepo.create).toHaveBeenCalledTimes(2);
      expect(songsRepo.create.mock.calls[0][0]).not.toHaveProperty('albumId');
      expect(playlistRepo.addSongToPlaylist).toHaveBeenCalledWith('pl-1', 'song-a.mp3');
      expect(playlistRepo.addSongToPlaylist).toHaveBeenCalledWith('pl-1', 'song-b.mp3');
      expect(librariesRepo.addAnalyzedFile).toHaveBeenCalledTimes(2);
      expect(Object.keys(library.analyzedFiles)).toHaveLength(2);
    });

    it('reuses existing playlist and songs on rescan', async () => {
      const { useCase, playlistRepo, songsRepo } = build();
      playlistRepo.findByFolder.mockResolvedValue({ id: 'pl-1', title: '2000s' });
      songsRepo.findByPath.mockImplementation(async (file: string) => ({
        id: `song-${path.basename(file)}`,
        codec: 'mp3',
        duration: 120,
        hasDolbyAtmos: false,
        atmosFileSrc: null,
        vocalsFileSrc: null,
        instrumentalFileSrc: null,
        fileModifiedAt: 1000,
      }));

      await useCase.execute(buildLibrary(), root);

      expect(playlistRepo.create).not.toHaveBeenCalled();
      expect(songsRepo.create).not.toHaveBeenCalled();
      expect(playlistRepo.addSongToPlaylist).toHaveBeenCalledTimes(2);
    });

    it('does nothing when the Playlists root is not a folder', async () => {
      const { useCase, fileSystem, playlistRepo } = build();
      fileSystem.isFolder.mockResolvedValue(false);

      await useCase.execute(buildLibrary(), root);

      expect(playlistRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('RemoveFolderPlayListUseCase', () => {
    it('deletes only albumless songs inside the playlist folder, then the playlist', async () => {
      const { songsRepo, playlistRepo } = build();
      songsRepo.findWithoutAlbum.mockResolvedValue([
        { id: 'local', fileSrc: path.join(folder2000s, 'a.mp3') },
        { id: 'other', fileSrc: path.join('elsewhere', 'b.mp3') },
      ]);

      await new RemoveFolderPlayListUseCase(
        playlistRepo as unknown as PlayListRepositoryPort,
        songsRepo as unknown as SongsRepositoryPort,
      ).execute({ id: 'pl-1', title: '2000s', folder: folder2000s });

      expect(songsRepo.delete).toHaveBeenCalledTimes(1);
      expect(songsRepo.delete).toHaveBeenCalledWith('local');
      expect(playlistRepo.delete).toHaveBeenCalledWith('pl-1');
    });
  });

  describe('local source protection', () => {
    const localError = {
      statusCode: 409,
      errors: { code: 'LOCAL_SOURCE_DELETE_FORBIDDEN' },
    };

    it('refuses to delete a playlist created from a folder', async () => {
      const { playlistRepo } = build();
      playlistRepo.findById.mockResolvedValue({ id: 'pl-1', folder: folder2000s });

      await expect(
        new DeletePlayListUseCase(playlistRepo as unknown as PlayListRepositoryPort).execute('pl-1'),
      ).rejects.toMatchObject(localError);
      expect(playlistRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes a playlist without folder', async () => {
      const { playlistRepo } = build();
      playlistRepo.findById.mockResolvedValue({ id: 'pl-1', folder: null });

      await new DeletePlayListUseCase(playlistRepo as unknown as PlayListRepositoryPort).execute(
        'pl-1',
      );

      expect(playlistRepo.delete).toHaveBeenCalledWith('pl-1');
    });

    it('refuses to remove a local song from its folder playlist but allows referenced ones', async () => {
      const { playlistRepo, songsRepo } = build();
      playlistRepo.findById.mockResolvedValue({ id: 'pl-1', folder: folder2000s });
      songsRepo.findById.mockImplementation(async (id: string) =>
        id === 'local'
          ? { id, albumId: null, fileSrc: path.join(folder2000s, 'a.mp3') }
          : { id, albumId: 'album-1', fileSrc: path.join('albums', 'b.mp3') },
      );
      const useCase = new RemoveSongFromPlayListUseCase(
        playlistRepo as unknown as PlayListRepositoryPort,
        songsRepo as unknown as SongsRepositoryPort,
      );

      await expect(useCase.execute('pl-1', 'local')).rejects.toMatchObject(localError);
      await expect(useCase.execute('pl-1', 'referenced')).resolves.toBeUndefined();
      expect(playlistRepo.removeSongFromPlaylist).toHaveBeenCalledTimes(1);
    });

    it('refuses to delete a song without album unless forced', async () => {
      const { songsRepo } = build();
      songsRepo.findById.mockResolvedValue({ id: 'local', albumId: null });
      const useCase = new DeleteSongUseCase(songsRepo as unknown as SongsRepositoryPort);

      await expect(useCase.execute('local')).rejects.toMatchObject(localError);
      expect(songsRepo.delete).not.toHaveBeenCalled();

      await useCase.execute('local', { force: true });
      expect(songsRepo.delete).toHaveBeenCalledWith('local');
    });
  });
});
