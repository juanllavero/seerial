/** biome-ignore-all lint/style/noNonNullAssertion: <Test file> */

import 'reflect-metadata';
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { PlayListItemModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListItemModel';
import { PlayListModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListModel';
import { PlayListRepositoryImpl } from '@/api/v1/playlists/infrastructure/persistence/repositories/PlayListRepositoryImpl';
import { SongModel } from '@/api/v1/songs/infrastructure/persistence/models/SongModel';
import { LibraryTypes } from '@/data/interfaces/Media';
import { clearAllTables, closeTestDataSource, getTestDataSource } from '../../helpers/test-db';

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  useCases: {},
  fileSystemService: { getExternalPath: jest.fn().mockReturnValue('/test') },
}));

let repo: PlayListRepositoryImpl;

beforeAll(async () => {
  await getTestDataSource();
  repo = new PlayListRepositoryImpl();
});

afterAll(async () => {
  await closeTestDataSource();
});

beforeEach(async () => {
  const ds = await getTestDataSource();
  await clearAllTables(ds);
});

async function createSongFixture() {
  const library = await LibraryModel.save({
    id: `lib-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Music Library',
    type: LibraryTypes.MUSIC,
    language: 'en',
    folders: [],
    order: 0,
    hidden: false,
  });

  const album = await AlbumModel.save({
    id: `alb-${Math.random().toString(36).slice(2, 10)}`,
    libraryId: library.id,
    title: 'Playlist Album',
    folder: '/music/playlist-album',
  });

  return SongModel.save({
    id: `song-${Math.random().toString(36).slice(2, 10)}`,
    albumId: album.id,
    fileSrc: '/music/playlist-album/song.mp3',
    title: 'Playlist Song',
  });
}

describe('PlayListRepositoryImpl', () => {
  it('findAll and findById return playlists with their songs', async () => {
    const created = await repo.create({
      userId: 'user-1',
      title: 'Lookup Playlist',
    } as never);
    const song = await createSongFixture();
    await repo.addSongToPlaylist(created.id, song.id);

    const all = await repo.findAll();
    const found = await repo.findById(created.id);

    expect(all).toHaveLength(1);
    expect(all[0].songs?.map((s) => s.id)).toEqual([song.id]);
    expect(found?.title).toBe('Lookup Playlist');
    expect(found?.songs?.map((s) => s.id)).toEqual([song.id]);
    expect(found).not.toHaveProperty('items');
    await expect(repo.findById('missing')).resolves.toBeNull();
  });

  it('finds folder playlists by folder and by library', async () => {
    const library = await LibraryModel.save({
      id: 'lib-folder',
      name: 'Music Library',
      type: LibraryTypes.MUSIC,
      language: 'en',
      folders: [],
      order: 0,
      hidden: false,
    });
    const created = await repo.create({
      title: '2000s',
      libraryId: library.id,
      folder: '/music/Playlists/2000s',
    } as never);

    await expect(repo.findByFolder('/music/Playlists/2000s')).resolves.toMatchObject({
      id: created.id,
      userId: null,
    });
    await expect(repo.findByFolder('/music/Playlists/other')).resolves.toBeNull();
    await expect(repo.findByLibrary(library.id)).resolves.toHaveLength(1);
  });

  it('creates a playlist row', async () => {
    const created = await repo.create({
      userId: 'user-1',
      title: 'Road Trip',
      description: 'Driving songs',
    } as never);

    const found = await PlayListModel.findOne({ where: { id: created.id } });
    expect(created.id).toBeTruthy();
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Road Trip');
  });

  it('stores multiple playlists', async () => {
    await repo.create({ userId: 'user-1', title: 'A' } as never);
    await repo.create({ userId: 'user-2', title: 'B' } as never);

    const all = await PlayListModel.find();
    expect(all.length).toBe(2);
  });

  it('returns an existing playlist when create is called with an existing id', async () => {
    const existing = await repo.create({
      userId: 'user-1',
      title: 'First',
    } as never);
    const spy = jest.spyOn(repo, 'findById').mockResolvedValue(existing as never);

    const second = await repo.create({
      id: existing.id,
      userId: 'user-2',
      title: 'Should Not Replace',
    } as never);

    expect(spy).toHaveBeenCalledWith(existing.id);
    expect(second.id).toBe(existing.id);
    expect(second.title).toBe(existing.title);

    spy.mockRestore();
  });

  it('updates and deletes a playlist', async () => {
    const created = await repo.create({
      userId: 'user-1',
      title: 'Temp',
    } as never);
    const updated = await repo.update(created.id, { title: 'Updated Title' });

    expect(updated.title).toBe('Updated Title');

    await repo.delete(created.id);
    await expect(PlayListModel.findOne({ where: { id: created.id } })).resolves.toBeNull();
  });

  it('does not create duplicate playlist-song relation when already present', async () => {
    const playlist = await repo.create({
      userId: 'user-1',
      title: 'Dup Check',
    } as never);
    const song = await createSongFixture();
    const songId = song.id;

    await repo.addSongToPlaylist(playlist.id, songId);
    await repo.addSongToPlaylist(playlist.id, songId);

    const rows = await PlayListItemModel.find({
      where: { playlistId: playlist.id, songId },
    });
    expect(rows).toHaveLength(1);
  });

  it('removes song relation from playlist', async () => {
    const playlist = await repo.create({
      userId: 'user-1',
      title: 'Remove Song',
    } as never);
    const song = await createSongFixture();
    const songId = song.id;

    await repo.addSongToPlaylist(playlist.id, songId);
    await repo.removeSongFromPlaylist(playlist.id, songId);

    const row = await PlayListItemModel.findOne({
      where: { playlistId: playlist.id, songId },
    });
    expect(row).toBeNull();
  });
});
