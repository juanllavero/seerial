import path from 'node:path';
import type { AudioInfo } from '@seerial/domain';
import type { FileSystemServicePort } from '@/api/v1/shared/application/ports/FileSystemServicePort';
import type { SongsRepositoryPort } from '@/api/v1/songs/application/ports/SongsRepositoryPort';
import { SongFileSyncService } from '@/api/v1/songs/application/services/SongFileSyncService';
import type { Song } from '@/api/v1/songs/domain/Song';
import { getSongVariant } from '@/utils/songVariants';

jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/audioInfo', () => ({
  getAudioInfo: jest.fn(),
}));

const folder = path.join('music', 'album');
const original = path.join(folder, 'song.flac');
const atmos = path.join(folder, 'song.atmos.m4a');
const vocals = path.join(folder, 'song.vocals.flac');
const inst = path.join(folder, 'song.inst.flac');

function file(name: string) {
  return { name, isFile: () => true, isDirectory: () => false };
}

function audio(overrides: Partial<AudioInfo> = {}): AudioInfo {
  return {
    title: 'Song',
    codec: 'flac',
    duration: 2,
    hasDolbyAtmos: false,
    ...overrides,
  } as AudioInfo;
}

function storedSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-1',
    fileSrc: original,
    codec: 'flac',
    duration: 120,
    hasDolbyAtmos: false,
    atmosFileSrc: null,
    vocalsFileSrc: null,
    instrumentalFileSrc: null,
    fileModifiedAt: 1000,
    ...overrides,
  } as Song;
}

function build(probe: Record<string, AudioInfo | undefined>, modifiedAt = 1000) {
  const fileSystem = {
    getFilesInFolder: jest.fn(),
    getFileStats: jest.fn().mockResolvedValue({ mtimeMs: modifiedAt }),
    isAudioFile: jest.fn().mockReturnValue(true),
  };
  const songsRepo = {
    findByPath: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (song: Partial<Song>) => ({ ...song, id: 'new' })),
    update: jest.fn().mockImplementation(async (_id: string, patch: Partial<Song>) => patch),
  };
  const readAudioInfo = jest.fn(async (filePath: string) => probe[filePath]);

  const service = new SongFileSyncService(
    fileSystem as unknown as FileSystemServicePort,
    songsRepo as unknown as SongsRepositoryPort,
    readAudioInfo,
  );

  return { fileSystem, songsRepo, readAudioInfo, service };
}

const buildNew = () => ({ title: 'Song' });

describe('getSongVariant', () => {
  it('detects vocals, inst and atmos files with any extension, case-insensitively', () => {
    expect(getSongVariant('/m/a.vocals.flac')).toEqual({ kind: 'vocals', baseName: 'a' });
    expect(getSongVariant('/m/A.INST.mp3')).toEqual({ kind: 'inst', baseName: 'A' });
    expect(getSongVariant('/m/a.b.atmos.m4a')).toEqual({ kind: 'atmos', baseName: 'a.b' });
  });

  it('ignores regular songs and names without a base name', () => {
    expect(getSongVariant('/m/song.flac')).toBeNull();
    expect(getSongVariant('/m/inst.flac')).toBeNull();
    expect(getSongVariant('/m/atmosphere.flac')).toBeNull();
  });
});

describe('SongFileSyncService', () => {
  describe('findCompanions', () => {
    it('matches companions to their song by name inside the same folder', async () => {
      const { service, fileSystem } = build({});
      fileSystem.getFilesInFolder.mockResolvedValue([
        file('Song.flac'),
        file('song.VOCALS.flac'),
        file('song.inst.flac'),
        file('song.atmos.m4a'),
        file('other.atmos.m4a'),
        file('cover.jpg'),
      ]);
      fileSystem.isAudioFile.mockImplementation((p: string) => !p.endsWith('.jpg'));

      const result = await service.findCompanions([path.join(folder, 'Song.flac')]);

      expect(result.get(path.join(folder, 'Song.flac'))).toEqual({
        vocals: path.join(folder, 'song.VOCALS.flac'),
        inst: path.join(folder, 'song.inst.flac'),
        atmos: [path.join(folder, 'song.atmos.m4a')],
      });
    });
  });

  describe('new songs', () => {
    it('marks an Atmos original as Atmos and ignores its .atmos file', async () => {
      const { service, songsRepo, readAudioInfo } = build({
        [original]: audio({ hasDolbyAtmos: true }),
      });

      await service.sync(original, { atmos: [atmos] }, buildNew);

      expect(songsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ hasDolbyAtmos: true, atmosFileSrc: null, fileModifiedAt: 1000 }),
      );
      expect(readAudioInfo).not.toHaveBeenCalledWith(atmos);
    });

    it('marks a non-Atmos song as Atmos when a valid .atmos file exists', async () => {
      const { service, songsRepo } = build({
        [original]: audio(),
        [atmos]: audio({ hasDolbyAtmos: true }),
      });

      await service.sync(original, { atmos: [atmos], vocals, inst }, buildNew);

      expect(songsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hasDolbyAtmos: true,
          atmosFileSrc: atmos,
          vocalsFileSrc: vocals,
          instrumentalFileSrc: inst,
        }),
      );
    });

    it('keeps the song non-Atmos when the .atmos file is not really Atmos', async () => {
      const { service, songsRepo } = build({ [original]: audio(), [atmos]: audio() });

      await service.sync(original, { atmos: [atmos] }, buildNew);

      expect(songsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ hasDolbyAtmos: false, atmosFileSrc: null }),
      );
    });

    it('does not create a song when the file cannot be read', async () => {
      const { service, songsRepo } = build({});

      await expect(service.sync(original, undefined, buildNew)).resolves.toBeNull();
      expect(songsRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('existing songs', () => {
    it('does nothing when nothing changed and does not re-probe files', async () => {
      const { service, songsRepo, readAudioInfo } = build({});
      songsRepo.findByPath.mockResolvedValue(storedSong());

      await service.sync(original, undefined, buildNew);

      expect(songsRepo.update).not.toHaveBeenCalled();
      expect(readAudioInfo).not.toHaveBeenCalled();
    });

    it('registers an .atmos file added after the first scan', async () => {
      const { service, songsRepo } = build({ [atmos]: audio({ hasDolbyAtmos: true }) });
      songsRepo.findByPath.mockResolvedValue(storedSong());

      await service.sync(original, { atmos: [atmos] }, buildNew);

      expect(songsRepo.update).toHaveBeenCalledWith('song-1', {
        hasDolbyAtmos: true,
        atmosFileSrc: atmos,
      });
    });

    it('trusts a registered .atmos file instead of probing it again', async () => {
      const { service, songsRepo, readAudioInfo } = build({});
      songsRepo.findByPath.mockResolvedValue(
        storedSong({ hasDolbyAtmos: true, atmosFileSrc: atmos }),
      );

      await service.sync(original, { atmos: [atmos] }, buildNew);

      expect(songsRepo.update).not.toHaveBeenCalled();
      expect(readAudioInfo).not.toHaveBeenCalled();
    });

    it('clears the Atmos data when the .atmos file is removed', async () => {
      const { service, songsRepo } = build({});
      songsRepo.findByPath.mockResolvedValue(
        storedSong({ hasDolbyAtmos: true, atmosFileSrc: atmos }),
      );

      await service.sync(original, undefined, buildNew);

      expect(songsRepo.update).toHaveBeenCalledWith('song-1', {
        hasDolbyAtmos: false,
        atmosFileSrc: null,
      });
    });

    it('detects when the original file becomes Atmos and drops the .atmos file', async () => {
      const { service, songsRepo } = build({ [original]: audio({ hasDolbyAtmos: true }) }, 2000);
      songsRepo.findByPath.mockResolvedValue(
        storedSong({ hasDolbyAtmos: true, atmosFileSrc: atmos }),
      );

      await service.sync(original, { atmos: [atmos] }, buildNew);

      expect(songsRepo.update).toHaveBeenCalledWith('song-1', {
        fileModifiedAt: 2000,
        atmosFileSrc: null,
      });
    });

    it('detects when an Atmos original is replaced by a non-Atmos one', async () => {
      const { service, songsRepo } = build({ [original]: audio() }, 2000);
      songsRepo.findByPath.mockResolvedValue(storedSong({ hasDolbyAtmos: true }));

      await service.sync(original, undefined, buildNew);

      expect(songsRepo.update).toHaveBeenCalledWith('song-1', {
        fileModifiedAt: 2000,
        hasDolbyAtmos: false,
      });
    });

    it('re-analyzes songs scanned before the file time was tracked', async () => {
      const { service, songsRepo, readAudioInfo } = build({
        [original]: audio({ hasDolbyAtmos: true }),
      });
      songsRepo.findByPath.mockResolvedValue(
        storedSong({ fileModifiedAt: null, hasDolbyAtmos: undefined }),
      );

      await service.sync(original, undefined, buildNew);

      expect(readAudioInfo).toHaveBeenCalledWith(original);
      expect(songsRepo.update).toHaveBeenCalledWith('song-1', {
        fileModifiedAt: 1000,
        hasDolbyAtmos: true,
      });
    });

    it('registers and unregisters vocals and instrumental stems', async () => {
      const { service, songsRepo } = build({});
      songsRepo.findByPath.mockResolvedValue(storedSong());

      await service.sync(original, { atmos: [], vocals, inst }, buildNew);
      expect(songsRepo.update).toHaveBeenLastCalledWith('song-1', {
        vocalsFileSrc: vocals,
        instrumentalFileSrc: inst,
      });

      songsRepo.findByPath.mockResolvedValue(
        storedSong({ vocalsFileSrc: vocals, instrumentalFileSrc: inst }),
      );
      await service.sync(original, undefined, buildNew);
      expect(songsRepo.update).toHaveBeenLastCalledWith('song-1', {
        vocalsFileSrc: null,
        instrumentalFileSrc: null,
      });
    });
  });
});
