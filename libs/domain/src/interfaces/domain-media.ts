import type { CastData, LibraryType } from './media-core';
import type { AudioTrack, Chapter, MediaInfo, SubtitleTrack, VideoTrack } from './media-info';

export interface Artist {
  id: string;
  name: string;
}

export interface Album {
  id: string;
  libraryId: string;
  title: string;
  year?: string;
  genres: string[];
  folder: string;
  description?: string;
  coverSrc: string;

  songs: Song[];
  albumArtists: AlbumArtist[];
}

export interface AlbumArtist {
  id: string;
  album: Album;
  artist: Artist;
}

export interface Collection {
  id: string;
  title: string;
  description?: string;
  backgroundSrc: string;
  backgroundsUrls: string[];
  coverSrc: string;
  coversUrls: string[];
  numberOfItems?: number;
  musicPosterSrc?: string;
  shows: Series[];
  movies: Movie[];
  albums: Album[];
  songs?: Song[];
}

export interface ContinueWatching {
  id: string;
  userId: string;
  seriesId?: string;
  series?: Series;
  movieId?: string;
  movie?: Movie;
  videoId: string;
  video: Video;
}

export interface Episode {
  id: string;
  seasonId: string;
  name: string;
  nameLock: boolean;
  year: string;
  yearLock: boolean;
  overview: string;
  overviewLock: boolean;
  score: number;
  directedBy: string[];
  directedByLock: boolean;
  writtenBy: string[];
  writtenByLock: boolean;
  episodeNumber: number;
  seasonNumber: number;
  order: number;
  /** TMDb episode the metadata come from, when its numbers are not the ones of this episode */
  metadataSeason?: number | null;
  metadataEpisode?: number | null;
  video: Video;
}

export interface Library {
  id: string;
  name: string;
  language: string;
  type: LibraryType;
  order: number;
  hidden: boolean;
  folders: string[];
  preferAudioLan?: string;
  preferSubLan?: string;
  subsMode?: string;
  analyzedFiles: Record<string, string>;
  analyzedFolders: Record<string, string>;
  backgroundSrc: string;
  series: Series[];
  movies: Movie[];
  albums: Album[];
  collections: Collection[];
}

/**
 * Library as returned by the list/detail endpoints: the (potentially huge) scan bookkeeping
 * (`analyzedFiles`, `analyzedFolders`) is not sent to clients.
 */
export type LibrarySummary = Omit<Library, 'analyzedFiles' | 'analyzedFolders'>;

export interface Movie {
  id: string;
  libraryId: string;
  imdbId: string;
  themdbId: number;
  imdbScore: number;
  score: number;
  order: number;
  name: string;
  nameLock: boolean;
  overview: string;
  overviewLock: boolean;
  year: string;
  yearLock: boolean;
  tagline: string;
  taglineLock: boolean;
  genres: string[];
  genresLock: boolean;
  productionStudios: string[];
  productionStudiosLock: boolean;
  directedBy: string[];
  directedByLock: boolean;
  writtenBy: string[];
  writtenByLock: boolean;
  creator: string[];
  creatorLock: boolean;
  musicComposer: string[];
  musicComposerLock: boolean;
  cast: CastData[];
  videoSrc: string;
  musicSrc: string;
  folder: string;
  logoSrc: string;
  logosUrls: string[];
  backgroundSrc: string;
  backgroundsUrls: string[];
  coverSrc: string;
  coversUrls: string[];
  watchLists: WatchList[];
  videos: Video[];
  extras: Video[];
}

export interface PlayList {
  id: string;
  /** Empty for playlists created from a library folder (shared by all users). */
  userId?: string | null;
  /** Set only for playlists created from a folder inside the library "Playlists" folder. */
  libraryId?: string | null;
  /** Source folder of a folder-based playlist. */
  folder?: string | null;
  title: string;
  description?: string;
  coverSrc?: string;
  /** False: songs are listed alphabetically. True: the admin reordered them manually. */
  customOrder?: boolean;
  /** Up to 4 album covers of its songs (for the playlist card). Only present with the songs. */
  images?: string[];
  /** Songs of the playlist (local and referenced). Only present when the playlist is fetched with its songs. */
  songs?: Song[];
}

export interface Season {
  id: string;
  seriesId: string;
  order: number;
  name: string;
  nameLock: boolean;
  year: string;
  yearLock: boolean;
  overview: string;
  overviewLock: boolean;
  seasonNumber: number;
  backgroundSrc: string;
  backgroundsUrls: string[];
  videoSrc: string;
  musicSrc: string;
  watchLists: WatchList[];
  episodes: Episode[];
}

export interface Series {
  id: string;
  libraryId: string;
  themdbId: number;
  order: number;
  name: string;
  nameLock: boolean;
  overview: string;
  overviewLock: boolean;
  year: string;
  yearLock: boolean;
  score: number;
  tagline: string;
  taglineLock: boolean;
  logoSrc: string;
  logosUrls: string[];
  coverSrc: string;
  coversUrls: string[];
  productionStudios: string[];
  productionStudiosLock: boolean;
  creator: string[];
  creatorLock: boolean;
  musicComposer: string[];
  musicComposerLock: boolean;
  genres: string[];
  genresLock: boolean;
  cast: CastData[];
  preferAudioLan?: string;
  preferSubLan?: string;
  subsMode?: string;
  folder: string;
  episodeGroupId: string | null;
  analyzingFiles: boolean;
  watchLists: WatchList[];
  seasons: Season[];
}

export interface Song {
  id?: string;
  /** Empty for songs that only belong to a folder-based playlist. */
  albumId?: string | null;
  title: string;
  codec: string;
  /** True when the song is Dolby Atmos, either the original file or its `.atmos` companion file. */
  hasDolbyAtmos: boolean;
  trackNumber: number;
  discNumber: number;
  artists: string[];
  composers: string[];
  duration: number;
  fileSrc: string;
  /**
   * Dolby Atmos version of a song whose original file is not Atmos (`name.atmos.ext`).
   * Null when the original is already Atmos or there is no valid Atmos companion file.
   */
  atmosFileSrc?: string | null;
  /** Vocals stem (`name.vocals.ext`) used for the karaoke mix. */
  vocalsFileSrc?: string | null;
  /** Instrumental stem (`name.inst.ext`) used for the karaoke mix. */
  instrumentalFileSrc?: string | null;
  /** Modification time (ms) of the original file when it was last analyzed. */
  fileModifiedAt?: number | null;
}

export interface LyricsLine {
  agent: 'v1' | 'v2';
  startTime: number;
  plainText?: PlainLyricsLine;
  words?: EnhancedLyricsLine;
  translation?: string;
  isBlank?: boolean;
}

export interface PlainLyricsLine {
  original?: string;
  pronunciation?: string;
}

export interface EnhancedLyricsLine {
  original: LyricWord[];
  pronunciation?: LyricWord[];
  backgroundVocals?: LyricWord[];
}

export interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface LRCFile {
  language: string;
  content: string;
}

export interface LRCLine {
  time: number;
  text: string;
}

export interface Video {
  id: string;
  title: string;
  fileSrc: string;
  hash: string;
  runtime: number;
  imgSrc: string;
  imgUrls: string[];
  continueWatching: ContinueWatching[];
  watchLists: WatchList[];
  mediaInfo?: MediaInfo;
  videoTracks?: VideoTrack[];
  subtitleTracks?: SubtitleTrack[];
  audioTracks?: AudioTrack[];
  chapters?: Chapter[];
  selectedAudioTrack?: number;
  selectedSubtitleTrack?: number;
  extraType?: string;
  episodeId?: string;
  movieId?: string;
}

export enum VideoType {
  MAIN = 'MAIN',
  EXTRA = 'EXTRA',
}

export interface WatchList {
  id: string;
  userId: string;
  seriesId?: string;
  seasonId?: string;
  episodeId?: string;
  episode?: Episode;
  movieId?: string;
  movie?: Movie;
  videoId?: string;
  video?: Video;
  timeWatched: number;
  watched: boolean;
  lastWatched: string;
}
