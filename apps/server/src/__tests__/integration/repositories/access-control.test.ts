/** biome-ignore-all lint/style/noNonNullAssertion: <Test file> */

import 'reflect-metadata';
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { CollectionModel } from '@/api/v1/collections/infrastructure/persistence/models/CollectionModel';
import { EpisodeModel } from '@/api/v1/episodes/infrastructure/persistence/models/EpisodeModel';
import { LibraryCollectionModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryCollectionModel';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { PlayListModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListModel';
import { PlayListRepositoryImpl } from '@/api/v1/playlists/infrastructure/persistence/repositories/PlayListRepositoryImpl';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { UserVideoPreferencesService } from '@/api/v1/shared/infrastructure/services/UserVideoPreferencesService';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import { DatabaseManager } from '@/api/v1/shared/infrastructure/persistence/DatabaseManager';
import { SongModel } from '@/api/v1/songs/infrastructure/persistence/models/SongModel';
import type { UserDTO } from '@/api/v1/users/application/dtos/UserDTOs';
import { UserModel } from '@/api/v1/users/infrastructure/persistence/models/UserModel';
import { UserVideoPreferenceModel } from '@/api/v1/users/infrastructure/persistence/models/UserVideoPreferenceModel';
import { UserPlayListModel } from '@/api/v1/users/infrastructure/persistence/models/UserPlayListModel';
import { UsersRepositoryImpl } from '@/api/v1/users/infrastructure/persistence/repositories/UsersRepositoryImpl';
import { VideoModel } from '@/api/v1/videos/infrastructure/persistence/models/VideoModel';
import { WatchListModel } from '@/api/v1/watch-lists/infrastructure/persistence/models/WatchListModel';
import { LibraryTypes } from '@/data/interfaces/Media';
import { UserType } from '@/utils/constants';
import { clearAllTables, closeTestDataSource, getTestDataSource } from '../../helpers/test-db';

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  useCases: {},
  fileSystemService: { getExternalPath: jest.fn().mockReturnValue('/test') },
}));

const usersRepo = new UsersRepositoryImpl();
const playListRepo = new PlayListRepositoryImpl();

beforeAll(async () => {
  const ds = await getTestDataSource();
  DatabaseManager.dataSource = ds;
});

afterAll(async () => {
  await closeTestDataSource();
});

beforeEach(async () => {
  const ds = await getTestDataSource();
  await clearAllTables(ds);
});

const asUser = (user: UserModel) => user as unknown as UserDTO;

async function createLibrary(id: string, type = LibraryTypes.MOVIES) {
  return LibraryModel.save({ id, name: id, type, language: 'en', folders: [], order: 0, hidden: false });
}

async function createSong(id: string, title: string, albumId?: string) {
  return SongModel.save({ id, albumId: albumId ?? null, fileSrc: `/music/${id}.mp3`, title });
}

describe('AccessControlService', () => {
  it('lets admins read everything and normal users only their libraries', async () => {
    await createLibrary('lib-a');
    await createLibrary('lib-b');
    const admin = await UserModel.create({ id: 'admin-1', username: 'admin', type: 'admin' }).save();
    const user = await usersRepo.create({ username: 'kid', libraryIds: ['lib-a'] });

    expect(await AccessControlService.getAllowedLibraryIds(asUser(admin))).toBeNull();
    expect(await AccessControlService.getAllowedLibraryIds(user as unknown as UserDTO)).toEqual([
      'lib-a',
    ]);

    await expect(AccessControlService.assertLibrary(user as unknown as UserDTO, 'lib-a')).resolves.toBeUndefined();
    await expect(
      AccessControlService.assertLibrary(user as unknown as UserDTO, 'lib-b'),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(AccessControlService.assertLibrary(asUser(admin), 'lib-b')).resolves.toBeUndefined();
  });

  it('resolves the library of movies, series, seasons, episodes, videos, albums and songs', async () => {
    await createLibrary('lib-a');
    await createLibrary('lib-b');
    const user = (await usersRepo.create({ username: 'kid', libraryIds: ['lib-a'] })) as unknown as UserDTO;

    await MovieModel.save({ id: 'movie-a', libraryId: 'lib-a', name: 'A' });
    await MovieModel.save({ id: 'movie-b', libraryId: 'lib-b', name: 'B' });
    await SeriesModel.save({ id: 'series-b', libraryId: 'lib-b', name: 'S' });
    await SeasonModel.save({ id: 'season-b', seriesId: 'series-b', name: 'S1', seasonNumber: 1, order: 0 });
    await EpisodeModel.save({
      id: 'episode-b',
      seasonId: 'season-b',
      name: 'E1',
      year: '2024',
      seasonNumber: 1,
      episodeNumber: 1,
      order: 0,
    });
    await VideoModel.save({ id: 'video-b', episodeId: 'episode-b', fileSrc: '/v/b.mkv' } as never);
    await VideoModel.save({ id: 'video-a', movieId: 'movie-a', fileSrc: '/v/a.mkv' } as never);
    await AlbumModel.save({ id: 'album-b', libraryId: 'lib-b', title: 'Alb', folder: '/m/b' });
    await createSong('song-b', 'Song B', 'album-b');

    await expect(AccessControlService.assertAccess(user, 'movie', 'movie-a')).resolves.toBeUndefined();
    await expect(AccessControlService.assertAccess(user, 'video', 'video-a')).resolves.toBeUndefined();

    for (const [kind, id] of [
      ['movie', 'movie-b'],
      ['series', 'series-b'],
      ['season', 'season-b'],
      ['episode', 'episode-b'],
      ['video', 'video-b'],
      ['album', 'album-b'],
      ['song', 'song-b'],
    ] as const) {
      await expect(AccessControlService.assertAccess(user, kind, id)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(await AccessControlService.canAccess(user, kind, id)).toBe(false);
    }
  });

  it('does not block unknown ids so the use case can answer 404', async () => {
    const user = (await usersRepo.create({ username: 'kid', libraryIds: [] })) as unknown as UserDTO;

    await expect(AccessControlService.assertAccess(user, 'movie', 'missing')).resolves.toBeUndefined();
    await expect(AccessControlService.assertAccess(user, 'playlist', 'missing')).resolves.toBeUndefined();
  });

  it('filters collections and collection items by readable libraries', async () => {
    await createLibrary('lib-a');
    await createLibrary('lib-b');
    const user = (await usersRepo.create({ username: 'kid', libraryIds: ['lib-a'] })) as unknown as UserDTO;
    await CollectionModel.save({ id: 'col-a', title: 'A' } as never);
    await CollectionModel.save({ id: 'col-b', title: 'B' } as never);
    await LibraryCollectionModel.save({ libraryId: 'lib-a', collectionId: 'col-a', order: 0 } as never);
    await LibraryCollectionModel.save({ libraryId: 'lib-b', collectionId: 'col-b', order: 0 } as never);
    await MovieModel.save({ id: 'movie-a', libraryId: 'lib-a', name: 'A' });
    await MovieModel.save({ id: 'movie-b', libraryId: 'lib-b', name: 'B' });

    expect(await AccessControlService.filterCollectionIds(user, ['col-a', 'col-b'])).toEqual(['col-a']);
    await expect(AccessControlService.assertAccess(user, 'collection', 'col-b')).rejects.toMatchObject({
      statusCode: 403,
    });

    const items = await AccessControlService.filterItemsByLibrary(user, 'movie', [
      { id: 'movie-a' },
      { id: 'movie-b' },
    ]);
    expect(items).toEqual([{ id: 'movie-a' }]);
  });

  it('governs playlists by library (folder) or by explicit grant (digital)', async () => {
    await createLibrary('lib-music', LibraryTypes.MUSIC);
    const user = (await usersRepo.create({ username: 'kid', libraryIds: [] })) as unknown as UserDTO;
    const folderList = await playListRepo.create({ title: 'Folder', libraryId: 'lib-music', folder: '/m/Playlists/x' } as never);
    const digitalList = await playListRepo.create({ title: 'Digital' } as never);

    expect(await AccessControlService.canAccessPlayList(user, folderList.id)).toBe(false);
    expect(await AccessControlService.canAccessPlayList(user, digitalList.id)).toBe(false);

    await usersRepo.update(user.id, { libraryIds: ['lib-music'], playlistIds: [digitalList.id] });

    expect(await AccessControlService.canAccessPlayList(user, folderList.id)).toBe(true);
    expect(await AccessControlService.canAccessPlayList(user, digitalList.id)).toBe(true);
  });

  it('lets a user read a song that only lives in a granted playlist', async () => {
    const user = (await usersRepo.create({ username: 'kid' })) as unknown as UserDTO;
    await createSong('song-1', 'Standalone');
    const playList = await playListRepo.create({ title: 'Digital' } as never);
    await playListRepo.addSongToPlaylist(playList.id, 'song-1');

    expect(await AccessControlService.canAccessSong(user, 'song-1')).toBe(false);

    await usersRepo.update(user.id, { playlistIds: [playList.id] });
    expect(await AccessControlService.canAccessSong(user, 'song-1')).toBe(true);
  });
});

describe('UsersRepositoryImpl access management', () => {
  it('replaces library and playlist grants only when provided and ignores unknown ids', async () => {
    await createLibrary('lib-a');
    await createLibrary('lib-b');
    const playList = await playListRepo.create({ title: 'P' } as never);
    const user = await usersRepo.create({ username: 'kid', libraryIds: ['lib-a'], playlistIds: [playList.id] });

    await usersRepo.update(user.id, { libraryIds: ['lib-b', 'unknown'] });
    let [listed] = (await usersRepo.findAllWithAccess()).filter((u) => u.id === user.id);
    expect(listed.libraryIds).toEqual(['lib-b']);
    expect(listed.playlistIds).toEqual([playList.id]); // untouched

    await usersRepo.update(user.id, { username: 'renamed', playlistIds: [] });
    [listed] = (await usersRepo.findAllWithAccess()).filter((u) => u.id === user.id);
    expect(listed.username).toBe('renamed');
    expect(listed.libraryIds).toEqual(['lib-b']);
    expect(listed.playlistIds).toEqual([]);
    expect(listed.password).toBeUndefined();
  });

  it('removes the grants and watch states of a deleted user', async () => {
    await createLibrary('lib-a');
    const playList = await playListRepo.create({ title: 'P' } as never);
    const user = await usersRepo.create({ username: 'kid', libraryIds: ['lib-a'], playlistIds: [playList.id] });
    await WatchListModel.save({ id: 'wl-1', userId: user.id, watched: false, timeWatched: 0 } as never);

    await usersRepo.delete(user.id);

    expect(await WatchListModel.count()).toBe(0);
    expect(await UserPlayListModel.count()).toBe(0);
    expect(await PlayListModel.count()).toBe(1);
  });
});

describe('UsersRepositoryImpl administrator safeguards', () => {
  it('refuses to delete or demote the last administrator', async () => {
    const admin = await usersRepo.create({ username: 'root', password: 'Secret123!', type: UserType.ADMIN });

    await expect(usersRepo.delete(admin.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(usersRepo.update(admin.id, { type: UserType.NORMAL })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await UserModel.count()).toBe(1);
  });

  it('allows removing an administrator when another one remains', async () => {
    const first = await usersRepo.create({ username: 'root', password: 'Secret123!', type: UserType.ADMIN });
    await usersRepo.create({ username: 'second', password: 'Secret123!', type: UserType.ADMIN });

    await expect(usersRepo.delete(first.id)).resolves.toBeUndefined();
  });

  it('requires a password to promote a user to administrator', async () => {
    const user = await usersRepo.create({ username: 'plain' });

    await expect(usersRepo.update(user.id, { type: UserType.ADMIN })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      usersRepo.update(user.id, { type: UserType.ADMIN, password: 'Secret123!' }),
    ).resolves.toMatchObject({ type: UserType.ADMIN });
  });

  it('answers 409 for a duplicated username on create and rename', async () => {
    await usersRepo.create({ username: 'taken' });
    const other = await usersRepo.create({ username: 'other' });

    await expect(usersRepo.create({ username: 'taken' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(usersRepo.update(other.id, { username: 'taken' })).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(usersRepo.update(other.id, { username: 'other' })).resolves.toBeDefined();
  });

  it('revokes sessions by bumping the token version', async () => {
    const user = await usersRepo.create({ username: 'kid' });
    const before = (await UserModel.findOne({ where: { id: user.id } }))!.tokenVersion;

    await usersRepo.revokeSessions(user.id);

    expect((await UserModel.findOne({ where: { id: user.id } }))!.tokenVersion).toBe(before + 1);
    await expect(usersRepo.revokeSessions('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Per-user track selection', () => {
  async function setupVideo() {
    await createLibrary('lib-a');
    await MovieModel.save({ id: 'movie-a', libraryId: 'lib-a', name: 'A' });
    await VideoModel.save({ id: 'video-a', movieId: 'movie-a', fileSrc: '/v/a.mkv' } as never);
    const alice = await usersRepo.create({ username: 'alice' });
    const bob = await usersRepo.create({ username: 'bob' });
    return { alice, bob };
  }
  const movieWith = () => ({
    id: 'movie-a',
    videos: [{ id: 'video-a', audioTracks: [{}, {}, {}], subtitleTracks: [{}, {}], selectedAudioTrack: 0 }],
    extras: [],
  });

  it('overlays only the selection of the user who made it', async () => {
    const { alice, bob } = await setupVideo();
    await UserVideoPreferencesService.save(alice.id, 'video-a', {
      selectedAudioTrack: 2,
      selectedSubtitleTrack: -1,
    });

    const forAlice = await UserVideoPreferencesService.overlay(alice.id, movieWith());
    const forBob = await UserVideoPreferencesService.overlay(bob.id, movieWith());

    expect(forAlice.videos[0].selectedAudioTrack).toBe(2);
    expect((forAlice.videos[0] as { selectedSubtitleTrack?: number }).selectedSubtitleTrack).toBe(-1);
    // Bob keeps the default of the video
    expect(forBob.videos[0].selectedAudioTrack).toBe(0);
    expect((forBob.videos[0] as { selectedSubtitleTrack?: number }).selectedSubtitleTrack).toBeUndefined();
  });

  it('keeps the other field when only one track is saved', async () => {
    const { alice } = await setupVideo();
    await UserVideoPreferencesService.save(alice.id, 'video-a', { selectedAudioTrack: 1 });
    await UserVideoPreferencesService.save(alice.id, 'video-a', { selectedSubtitleTrack: 0 });

    const result = await UserVideoPreferencesService.overlay(alice.id, movieWith());
    expect(result.videos[0].selectedAudioTrack).toBe(1);
    expect((result.videos[0] as { selectedSubtitleTrack?: number }).selectedSubtitleTrack).toBe(0);
    expect(await UserVideoPreferenceModel.count()).toBe(1);
  });

  it('finds videos nested at any depth (series > seasons > episodes)', async () => {
    const { alice } = await setupVideo();
    await UserVideoPreferencesService.save(alice.id, 'video-a', { selectedAudioTrack: 2 });
    const series = { id: 's', seasons: [{ id: 'se', episodes: [{ id: 'e', video: { id: 'video-a', audioTracks: [{}] } }] }] };

    await UserVideoPreferencesService.overlay(alice.id, series);

    expect((series.seasons[0].episodes[0].video as { selectedAudioTrack?: number }).selectedAudioTrack).toBe(2);
  });

  it('is removed together with the user or the video', async () => {
    const { alice } = await setupVideo();
    await UserVideoPreferencesService.save(alice.id, 'video-a', { selectedAudioTrack: 1 });

    await usersRepo.delete(alice.id);

    expect(await UserVideoPreferenceModel.count()).toBe(0);
  });
});

describe('Playlist ordering', () => {
  async function setup() {
    const playList = await playListRepo.create({ title: 'Mix' } as never);
    await createSong('s-b', 'banana');
    await createSong('s-a', 'Apple');
    await createSong('s-c', 'cherry');
    for (const id of ['s-b', 's-a', 's-c']) {
      await playListRepo.addSongToPlaylist(playList.id, id);
    }
    return playList;
  }

  it('lists songs alphabetically by default', async () => {
    const playList = await setup();

    const found = await playListRepo.findById(playList.id);

    expect(found?.songs?.map((s) => s.title)).toEqual(['Apple', 'banana', 'cherry']);
    expect(found?.customOrder).toBe(false);
  });

  it('keeps a manual order and appends new songs at the end', async () => {
    const playList = await setup();

    await playListRepo.reorderSongs(playList.id, ['s-c', 's-b', 's-a']);
    let found = await playListRepo.findById(playList.id);
    expect(found?.songs?.map((s) => s.id)).toEqual(['s-c', 's-b', 's-a']);
    expect(found?.customOrder).toBe(true);

    await createSong('s-0', 'aardvark');
    await playListRepo.addSongToPlaylist(playList.id, 's-0');
    found = await playListRepo.findById(playList.id);
    expect(found?.songs?.map((s) => s.id)).toEqual(['s-c', 's-b', 's-a', 's-0']);
  });

  it('keeps songs missing from the request after the listed ones', async () => {
    const playList = await setup();

    await playListRepo.reorderSongs(playList.id, ['s-c', 'not-in-playlist']);

    const found = await playListRepo.findById(playList.id);
    expect(found?.songs?.map((s) => s.id)).toEqual(['s-c', 's-a', 's-b']);
  });

  it('exposes up to 4 distinct album covers without embedding the albums', async () => {
    await createLibrary('lib-m', LibraryTypes.MUSIC);
    const playList = await playListRepo.create({ title: 'Covers' } as never);
    for (let i = 0; i < 6; i++) {
      await AlbumModel.save({
        id: `alb-${i}`,
        libraryId: 'lib-m',
        title: `Album ${i}`,
        folder: `/m/${i}`,
        coverSrc: i === 1 ? '' : `/covers/${i % 5}.jpg`,
      } as never);
      await createSong(`cs-${i}`, `Song ${i}`, `alb-${i}`);
      await playListRepo.addSongToPlaylist(playList.id, `cs-${i}`);
    }

    const found = await playListRepo.findById(playList.id);

    expect(found?.images).toEqual(['/covers/0.jpg', '/covers/2.jpg', '/covers/3.jpg', '/covers/4.jpg']);
    expect(found?.songs).toHaveLength(6);
    expect(found?.songs?.[0]).not.toHaveProperty('album');
  });

  it('answers 404 for unknown songs and playlists', async () => {
    const playList = await playListRepo.create({ title: 'Empty' } as never);

    await expect(playListRepo.addSongToPlaylist(playList.id, 'ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(playListRepo.addSongToPlaylist('ghost', 'ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(playListRepo.reorderSongs('ghost', [])).rejects.toMatchObject({ statusCode: 404 });
  });
});
