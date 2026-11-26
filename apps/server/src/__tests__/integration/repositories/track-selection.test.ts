/** biome-ignore-all lint/style/noNonNullAssertion: <Test file> */

import 'reflect-metadata';
import type { AudioTrack, SubtitleTrack } from '@seerial/domain';
import { EpisodeModel } from '@/api/v1/episodes/infrastructure/persistence/models/EpisodeModel';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { DatabaseManager } from '@/api/v1/shared/infrastructure/persistence/DatabaseManager';
import { TrackSelectionService } from '@/api/v1/shared/infrastructure/services/TrackSelectionService';
import { UserVideoPreferenceModel } from '@/api/v1/users/infrastructure/persistence/models/UserVideoPreferenceModel';
import { UserModel } from '@/api/v1/users/infrastructure/persistence/models/UserModel';
import { VideoModel } from '@/api/v1/videos/infrastructure/persistence/models/VideoModel';
import { LibraryTypes } from '@/data/interfaces/Media';
import { clearAllTables, closeTestDataSource, getTestDataSource } from '../../helpers/test-db';

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  useCases: {},
  fileSystemService: { getExternalPath: jest.fn().mockReturnValue('/test') },
}));

beforeAll(async () => {
  DatabaseManager.dataSource = await getTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource();
});

beforeEach(async () => {
  await clearAllTables(await getTestDataSource());
});

const audio = (languageTag: string, extra: Partial<AudioTrack> = {}): AudioTrack =>
  ({
    id: 0,
    languageTag,
    language: '',
    codec: 'AC3',
    displayTitle: '(AC3 5.1)',
    selected: false,
    ...extra,
  }) as AudioTrack;

const subtitle = (languageTag: string, extra: Partial<SubtitleTrack> = {}): SubtitleTrack =>
  ({
    id: 0,
    languageTag,
    language: '',
    codec: 'SUBRIP',
    displayTitle: '(SRT)',
    title: '',
    selected: false,
    forced: false,
    ...extra,
  }) as SubtitleTrack;

const JAPANESE_EPISODE = {
  audioTracks: [audio('jpn'), audio('eng')],
  subtitleTracks: [
    subtitle('spa', { title: 'Castellano' }),
    subtitle('spa', { title: 'Latino' }),
    subtitle('spa', { forced: true, displayTitle: '(Forced)(SRT)' }),
    subtitle('eng'),
  ],
};

async function createSeries(libraryPrefs: Partial<LibraryModel> = {}) {
  await LibraryModel.save({
    id: 'lib',
    name: 'Anime',
    type: LibraryTypes.SHOWS,
    language: 'es',
    folders: [],
    order: 0,
    hidden: false,
    preferAudioLan: 'ja',
    preferSubLan: 'es',
    subsMode: 'autoSubs',
    ...libraryPrefs,
  });
  await UserModel.create({ id: 'user', username: 'user', type: 'admin' }).save();
  await UserModel.create({ id: 'other', username: 'other', type: 'admin' }).save();
  await SeriesModel.save({ id: 'series', libraryId: 'lib', name: 'Anime' });
  await SeasonModel.save({ id: 'season', seriesId: 'series', name: 'S1', seasonNumber: 1, order: 0 });

  for (const number of [1, 2, 3]) {
    await EpisodeModel.save({
      id: `episode-${number}`,
      seasonId: 'season',
      name: `E${number}`,
      year: '2024',
      seasonNumber: 1,
      episodeNumber: number,
    });
    await VideoModel.save({
      id: `video-${number}`,
      episodeId: `episode-${number}`,
      fileSrc: `/v/${number}.mkv`,
      ...JAPANESE_EPISODE,
    } as never);
  }
}

const selectionOf = async (id: string) => {
  const video = (await VideoModel.findOne({ where: { id } }))!;
  return [video.selectedAudioTrack, video.selectedSubtitleTrack];
};

describe('TrackSelectionService.applyToLibrary', () => {
  it('selects the preferred audio and the forced subtitles when the audio is the preferred one', async () => {
    await createSeries();

    expect(await TrackSelectionService.applyToLibrary('lib')).toBe(3);

    // Japanese audio (the preferred one): only the forced Spanish track
    expect(await selectionOf('video-1')).toEqual([0, 2]);
  });

  it('shows the full subtitles of the language when the mode is "always"', async () => {
    await createSeries({ subsMode: 'alwaysSubs' });

    await TrackSelectionService.applyToLibrary('lib');

    expect(await selectionOf('video-1')).toEqual([0, 0]);
  });

  it('selects no subtitles when the mode is "never"', async () => {
    await createSeries({ subsMode: 'manualSubs' });

    await TrackSelectionService.applyToLibrary('lib');

    expect(await selectionOf('video-1')).toEqual([0, -1]);
  });

  it('does not touch videos that already have a selection unless it is forced', async () => {
    await createSeries();
    await VideoModel.update('video-1', { selectedAudioTrack: 1, selectedSubtitleTrack: 3 });

    await TrackSelectionService.applyToLibrary('lib');
    expect(await selectionOf('video-1')).toEqual([1, 3]);

    await TrackSelectionService.applyToLibrary('lib', true);
    expect(await selectionOf('video-1')).toEqual([0, 2]);
  });

  it('prefers the preferences of the series over the ones of the library', async () => {
    await createSeries();
    await SeriesModel.update('series', { preferAudioLan: 'en', subsMode: 'autoSubs', preferSubLan: 'en' });

    await TrackSelectionService.applyToSeries('series');

    // English audio and English subtitles: the audio is the preferred one, there are no forced ones
    expect(await selectionOf('video-1')).toEqual([1, -1]);
  });

  it('selects the tracks of the videos of a movie library', async () => {
    await LibraryModel.save({
      id: 'movies',
      name: 'Movies',
      type: LibraryTypes.MOVIES,
      language: 'es',
      folders: [],
      order: 0,
      hidden: false,
      preferAudioLan: 'es',
      preferSubLan: 'es',
      subsMode: 'autoSubs',
    });
    await MovieModel.save({ id: 'movie', libraryId: 'movies', name: 'M' });
    await VideoModel.save({
      id: 'movie-video',
      movieId: 'movie',
      fileSrc: '/m.mkv',
      audioTracks: [audio('eng'), audio('spa')],
      subtitleTracks: [subtitle('spa', { forced: true }), subtitle('spa')],
    } as never);

    await TrackSelectionService.applyToLibrary('movies');

    // Spanish audio is the preferred one: forced subtitles
    expect(await selectionOf('movie-video')).toEqual([1, 0]);
  });
});

describe('TrackSelectionService.prepareLibraries', () => {
  it('rewrites the names and labels saved by the old web client', async () => {
    await createSeries({ preferAudioLan: '日本語', preferSubLan: 'Español', subsMode: 'Mostrar siempre' });

    await TrackSelectionService.prepareLibraries();

    const library = (await LibraryModel.findOne({ where: { id: 'lib' } }))!;
    expect(library.preferAudioLan).toBe('ja');
    expect(library.preferSubLan).toBe('es');
    expect(library.subsMode).toBe('alwaysSubs');
    // ...and the tracks follow them
    expect(await selectionOf('video-1')).toEqual([0, 0]);
  });
});

describe('TrackSelectionService.propagate', () => {
  it('applies the choice of an episode to the others, looking for the same tracks', async () => {
    await createSeries();
    await UserVideoPreferenceModel.save({
      userId: 'user',
      videoId: 'video-1',
      selectedAudioTrack: 1,
      selectedSubtitleTrack: 1,
    } as never);

    // The user picked the English audio and the second Spanish track in the first episode
    const changed = await TrackSelectionService.propagate('user', 'video-1', {
      selectedAudioTrack: 1,
      selectedSubtitleTrack: 1,
    });

    expect(changed).toBe(2);
    const rows = await UserVideoPreferenceModel.find({ where: { userId: 'user' }, order: { videoId: 'ASC' } });
    expect(rows.map((row) => [row.videoId, row.selectedAudioTrack, row.selectedSubtitleTrack])).toEqual([
      ['video-1', 1, 1],
      ['video-2', 1, 1],
      ['video-3', 1, 1],
    ]);
  });

  it('leaves alone the episodes without the same track and the choices of other users', async () => {
    await createSeries();
    // The third episode only has one Spanish track and no English audio
    await VideoModel.update('video-3', {
      audioTracks: [audio('jpn')],
      subtitleTracks: [subtitle('spa', { title: 'Castellano' })],
    });
    await UserVideoPreferenceModel.save({
      userId: 'other',
      videoId: 'video-2',
      selectedAudioTrack: 0,
      selectedSubtitleTrack: 0,
    } as never);

    await TrackSelectionService.propagate('user', 'video-1', {
      selectedAudioTrack: 1,
      selectedSubtitleTrack: 1,
    });

    const rowOf = async (userId: string, videoId: string) =>
      UserVideoPreferenceModel.findOne({ where: { userId, videoId } });
    expect(await rowOf('user', 'video-2')).toMatchObject({ selectedAudioTrack: 1, selectedSubtitleTrack: 1 });
    // No English audio and no second Spanish track: nothing to apply
    expect(await rowOf('user', 'video-3')).toBeNull();
    expect(await rowOf('other', 'video-2')).toMatchObject({ selectedAudioTrack: 0, selectedSubtitleTrack: 0 });
  });

  it('propagates "no subtitles" and does nothing for movies', async () => {
    await createSeries();
    await TrackSelectionService.propagate('user', 'video-1', { selectedSubtitleTrack: -1 });

    const row = (await UserVideoPreferenceModel.findOne({ where: { userId: 'user', videoId: 'video-3' } }))!;
    expect(row.selectedSubtitleTrack).toBe(-1);
    expect(row.selectedAudioTrack).toBeNull();

    await MovieModel.save({ id: 'movie', libraryId: 'lib', name: 'M' });
    await VideoModel.save({ id: 'movie-video', movieId: 'movie', fileSrc: '/m.mkv', audioTracks: [] } as never);
    expect(await TrackSelectionService.propagate('user', 'movie-video', { selectedAudioTrack: 0 })).toBe(0);
  });
});
