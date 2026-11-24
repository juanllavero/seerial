import type { Request } from 'express';
import { In } from 'typeorm';
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { EpisodeModel } from '@/api/v1/episodes/infrastructure/persistence/models/EpisodeModel';
import { LibraryCollectionModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryCollectionModel';
import { MovieModel } from '@/api/v1/movies/infrastructure/persistence/models/MovieModel';
import { PlayListItemModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListItemModel';
import { PlayListModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListModel';
import { SeasonModel } from '@/api/v1/seasons/infrastructure/persistence/models/SeasonModel';
import { SeriesModel } from '@/api/v1/series/infrastructure/persistence/models/SeriesModel';
import { SongModel } from '@/api/v1/songs/infrastructure/persistence/models/SongModel';
import type { UserDTO } from '@/api/v1/users/application/dtos/UserDTOs';
import { UserLibraryModel } from '@/api/v1/users/infrastructure/persistence/models/UserLibraryModel';
import { UserPlayListModel } from '@/api/v1/users/infrastructure/persistence/models/UserPlayListModel';
import { VideoModel } from '@/api/v1/videos/infrastructure/persistence/models/VideoModel';
import { messages } from '@/config/messages';
import { UserType } from '@/utils/constants';
import { ForbiddenException, UnauthorizedException } from '../web/exceptions/HTTPExceptions';

export type AccessKind =
  | 'library'
  | 'movie'
  | 'series'
  | 'season'
  | 'episode'
  | 'album'
  | 'video'
  | 'song'
  | 'collection'
  | 'playlist';

/**
 * Read access rules (Jellyfin-like):
 * - Admins can access everything.
 * - Normal users can only read content of the libraries an admin granted them (`UserLibrary`),
 *   plus the non folder-based playlists granted to them (`UserPlayList`). They can never edit.
 *
 * Methods throw 403 when the user has no access. Resources that do not exist are NOT blocked here,
 * so the use case keeps answering with its own 404.
 */
export class AccessControlService {
  private constructor() {}

  static isAdmin(user: Pick<UserDTO, 'type'> | undefined | null): boolean {
    return user?.type === UserType.ADMIN;
  }

  static requireUser(req: Request): UserDTO {
    if (!req.user) throw new UnauthorizedException(messages.errors.token.missing);
    return req.user;
  }

  /** Ids of the libraries the user can read, or `null` when the user can read all of them. */
  static async getAllowedLibraryIds(user: UserDTO): Promise<string[] | null> {
    if (AccessControlService.isAdmin(user)) return null;
    const rows = await UserLibraryModel.find({ where: { userId: user.id } });
    return rows.map((row) => row.libraryId);
  }

  /** Ids of the non folder-based playlists granted to the user, or `null` for admins. */
  static async getGrantedPlayListIds(user: UserDTO): Promise<string[] | null> {
    if (AccessControlService.isAdmin(user)) return null;
    const rows = await UserPlayListModel.find({ where: { userId: user.id } });
    return rows.map((row) => row.playlistId);
  }

  static async canAccessLibrary(user: UserDTO, libraryId: string): Promise<boolean> {
    const allowed = await AccessControlService.getAllowedLibraryIds(user);
    return allowed === null || allowed.includes(libraryId);
  }

  static async assertLibrary(user: UserDTO, libraryId: string): Promise<void> {
    if (!(await AccessControlService.canAccessLibrary(user, libraryId))) {
      throw new ForbiddenException(messages.errors.token.noAccess);
    }
  }

  /** Same as `assertAccess`, but answers with a boolean. */
  static async canAccess(user: UserDTO, kind: AccessKind, id: string): Promise<boolean> {
    try {
      await AccessControlService.assertAccess(user, kind, id);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || (error as { statusCode?: number })?.statusCode === 403) {
        return false;
      }
      throw error;
    }
  }

  /** Throws 403 unless the user can read the given library item. */
  static async assertAccess(user: UserDTO, kind: AccessKind, id: string): Promise<void> {
    if (AccessControlService.isAdmin(user)) return;

    if (kind === 'playlist') {
      if (!(await AccessControlService.canAccessPlayList(user, id))) {
        throw new ForbiddenException(messages.errors.token.noAccess);
      }
      return;
    }

    if (kind === 'song') {
      if (!(await AccessControlService.canAccessSong(user, id))) {
        throw new ForbiddenException(messages.errors.token.noAccess);
      }
      return;
    }

    const libraryIds = await AccessControlService.resolveLibraryIds(kind, id);
    if (libraryIds === null) return; // Unknown id: let the use case answer 404

    const allowed = await AccessControlService.getAllowedLibraryIds(user);
    if (allowed !== null && !libraryIds.some((libraryId) => allowed.includes(libraryId))) {
      throw new ForbiddenException(messages.errors.token.noAccess);
    }
  }

  static async canAccessPlayList(user: UserDTO, playListId: string): Promise<boolean> {
    if (AccessControlService.isAdmin(user)) return true;

    const playList = await PlayListModel.findOne({
      where: { id: playListId },
      select: { id: true, libraryId: true },
    });
    if (!playList) return true; // Unknown id: let the use case answer 404

    if (playList.libraryId) {
      return AccessControlService.canAccessLibrary(user, playList.libraryId);
    }

    const grant = await UserPlayListModel.findOne({
      where: { userId: user.id, playlistId: playListId },
    });
    return !!grant;
  }

  /** A song is readable through its album's library or through any playlist the user can read. */
  static async canAccessSong(user: UserDTO, songId: string): Promise<boolean> {
    if (AccessControlService.isAdmin(user)) return true;

    const song = await SongModel.findOne({ where: { id: songId }, select: { id: true, albumId: true } });
    if (!song) return true;

    if (song.albumId) {
      const libraryIds = await AccessControlService.resolveLibraryIds('album', song.albumId);
      if (libraryIds === null) return true;
      const allowed = (await AccessControlService.getAllowedLibraryIds(user)) ?? [];
      if (libraryIds.some((libraryId) => allowed.includes(libraryId))) return true;
    }

    const items = await PlayListItemModel.find({ where: { songId }, select: { playlistId: true } });
    for (const item of items) {
      if (await AccessControlService.canAccessPlayList(user, item.playlistId)) return true;
    }
    return false;
  }

  /**
   * Libraries a library item belongs to.
   * Returns `null` when the item does not exist.
   */
  static async resolveLibraryIds(kind: AccessKind, id: string): Promise<string[] | null> {
    switch (kind) {
      case 'library':
        return [id];
      case 'movie': {
        const movie = await MovieModel.findOne({ where: { id }, select: { id: true, libraryId: true } });
        return movie ? [movie.libraryId] : null;
      }
      case 'series': {
        const series = await SeriesModel.findOne({ where: { id }, select: { id: true, libraryId: true } });
        return series ? [series.libraryId] : null;
      }
      case 'album': {
        const album = await AlbumModel.findOne({ where: { id }, select: { id: true, libraryId: true } });
        return album ? [album.libraryId] : null;
      }
      case 'season': {
        const season = await SeasonModel.findOne({ where: { id }, select: { id: true, seriesId: true } });
        return season ? AccessControlService.resolveLibraryIds('series', season.seriesId) : null;
      }
      case 'episode': {
        const episode = await EpisodeModel.findOne({ where: { id }, select: { id: true, seasonId: true } });
        return episode ? AccessControlService.resolveLibraryIds('season', episode.seasonId) : null;
      }
      case 'video': {
        const video = await VideoModel.findOne({
          where: { id },
          select: { id: true, episodeId: true, movieId: true, extraId: true },
        });
        if (!video) return null;
        if (video.episodeId) return AccessControlService.resolveLibraryIds('episode', video.episodeId);
        const movieId = video.movieId ?? video.extraId;
        if (movieId) return AccessControlService.resolveLibraryIds('movie', movieId);
        return null;
      }
      case 'collection': {
        const rows = await LibraryCollectionModel.find({ where: { collectionId: id } });
        return rows.length > 0 ? rows.map((row) => row.libraryId) : null;
      }
      default:
        return null;
    }
  }

  /** Narrows a list of ids to the ones the user can read (used for list endpoints). */
  static async filterLibraryIds(user: UserDTO, libraryIds: string[]): Promise<string[]> {
    const allowed = await AccessControlService.getAllowedLibraryIds(user);
    return allowed === null ? libraryIds : libraryIds.filter((id) => allowed.includes(id));
  }

  /** Collection ids (from the given ones) that have at least one library the user can read. */
  static async filterCollectionIds(user: UserDTO, collectionIds: string[]): Promise<string[]> {
    const allowed = await AccessControlService.getAllowedLibraryIds(user);
    if (allowed === null || collectionIds.length === 0) return collectionIds;
    if (allowed.length === 0) return [];

    const rows = await LibraryCollectionModel.find({
      where: { collectionId: In(collectionIds), libraryId: In(allowed) },
    });
    const visible = new Set(rows.map((row) => row.collectionId));
    return collectionIds.filter((id) => visible.has(id));
  }

  /** Keeps only the movies/series/albums that live in a library the user can read. */
  static async filterItemsByLibrary<T extends { id: string }>(
    user: UserDTO,
    kind: 'movie' | 'series' | 'album',
    items: T[],
  ): Promise<T[]> {
    const allowed = await AccessControlService.getAllowedLibraryIds(user);
    if (allowed === null || items.length === 0) return items;
    if (allowed.length === 0) return [];

    const where = { id: In(items.map((item) => item.id)), libraryId: In(allowed) };
    const rows =
      kind === 'movie'
        ? await MovieModel.find({ where, select: { id: true } })
        : kind === 'series'
          ? await SeriesModel.find({ where, select: { id: true } })
          : await AlbumModel.find({ where, select: { id: true } });
    const visible = new Set(rows.map((row) => row.id));
    return items.filter((item) => visible.has(item.id));
  }

  /** Throws 403 for anything that is not an admin. Used for write-only concerns on shared routes. */
  static assertAdmin(user: UserDTO | undefined | null): void {
    if (!AccessControlService.isAdmin(user)) {
      throw new ForbiddenException(messages.errors.token.noAccess);
    }
  }
}
