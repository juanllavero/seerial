import type { User } from '@seerial/domain';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { In } from 'typeorm';
import { BaseRepository } from '@/api/v1/base-repository/BaseRepository';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { PlayListModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListModel';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { messages } from '@/config/messages';
import { GenericRepositoryHelper } from '@/helpers/GenericRepositoryHelper';
import { UserType } from '@/utils/constants';
import { getJwtSecret } from '@/utils/jwt-secret';
import type { UsersRepositoryPort } from '../../../application/ports/UsersRepositoryPort';
import { UserLibraryModel } from '../models/UserLibraryModel';
import { UserPlayListModel } from '../models/UserPlayListModel';
import { UserModel } from '../models/UserModel';

export class UsersRepositoryImpl extends BaseRepository implements UsersRepositoryPort {
  // Generic helper for common CRUD operations
  private helper: GenericRepositoryHelper<UserModel, User>;

  constructor() {
    super();

    // Initialize helper
    this.helper = new GenericRepositoryHelper(UserModel, {
      entityName: 'User',
      generateShortId: true,
    });
  }

  async findAll(): Promise<User[]> {
    return this.helper.findAll({
      where: { hideInLogin: false },
      select: ['id', 'username', 'type', 'avatar'], // Exclude sensitive fields like password
    });
  }

  async authenticate(
    username: string,
    password: string | null,
  ): Promise<{ token: string; user: User | null } | null> {
    const user = await UserModel.findOne({ where: { username } });
    if (!user) return null;

    if (user.password) {
      if (!password || !(await bcrypt.compare(password, user.password))) {
        return null;
      }
    } else if (password) {
      return null; // No password set, but one provided
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        type: user.type,
        tokenVersion: user.tokenVersion,
      },
      getJwtSecret(),
      { expiresIn: '30d' },
    );

    const safeUser = await UserModel.findOne({
      where: { id: user.id },
      select: { password: false },
    });
    return {
      token,
      user: safeUser ? (safeUser as unknown as User) : (user as unknown as User),
    };
  }

  async create(
    data: Partial<{
      username: string;
      password?: string;
      type?: UserType;
      allowRemote?: boolean;
      allowVideoTranscoding?: boolean;
      internetBitrateLimit?: number;
      allowDownloads?: boolean;
      hideInLogin?: boolean;
      maxSessions?: number;
      libraryIds?: string[];
      playlistIds?: string[];
    }>,
  ): Promise<User> {
    if (data.type === 'admin' && !data.password?.trim()) {
      throw new BadRequestException(messages.errors.validation.userAdminNoPassword);
    }

    await this.assertUsernameAvailable(data.username);

    const hashedPassword = data.password ? await bcrypt.hash(data.password, 10) : null;

    const { libraryIds, playlistIds, ...userFields } = data;
    const userData = {
      ...userFields,
      password: hashedPassword || undefined,
      type: data.type || UserType.NORMAL,
      allowRemote: data.allowRemote ?? true,
      allowVideoTranscoding: data.allowVideoTranscoding ?? true,
      allowDownloads: data.allowDownloads ?? true,
      hideInLogin: data.hideInLogin ?? false,
      maxSessions: data.maxSessions ?? 0,
    };

    const user = await this.helper.create(userData, true);

    await this.setAccess(user.id, { libraryIds, playlistIds });

    const safeUser = await UserModel.findOne({
      where: { id: user.id },
      select: { password: false },
    });
    return safeUser ? (safeUser as unknown as User) : (user as unknown as User);
  }

  async update(
    id: string,
    input: Partial<User> & { libraryIds?: string[]; playlistIds?: string[] },
  ): Promise<User> {
    const { libraryIds, playlistIds, ...data } = input;
    if (data.username) {
      await this.assertUsernameAvailable(data.username, id);
    }

    if (data.type && data.type !== UserType.ADMIN) {
      await this.assertNotLastAdmin(id);
    }

    if (data.type === UserType.ADMIN) {
      const existing = await UserModel.findOne({ where: { id } });
      if (!data.password?.trim() && !existing?.password) {
        throw new BadRequestException(messages.errors.validation.userAdminNoPassword);
      }
    }

    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
      // Invalidate all existing tokens when the password changes
      const existing = await UserModel.findOne({ where: { id } });
      if (existing) {
        await UserModel.update(id, {
          tokenVersion: (existing.tokenVersion ?? 0) + 1,
        });
      }
    }

    const updated = Object.keys(data).length > 0 ? await this.helper.update(id, data) : await this.findSafeById(id);
    await this.setAccess(id, { libraryIds, playlistIds });
    return updated;
  }

  async findAllWithAccess(): Promise<(User & { libraryIds: string[]; playlistIds: string[] })[]> {
    const users = await UserModel.find({
      select: ['id', 'username', 'type', 'avatar', 'allowRemote', 'allowVideoTranscoding', 'internetBitrateLimit', 'allowDownloads', 'hideInLogin', 'maxSessions'],
    });
    const [libraries, playlists] = await Promise.all([
      UserLibraryModel.find(),
      UserPlayListModel.find(),
    ]);
    return users.map((user) => ({
      ...(user as unknown as User),
      libraryIds: libraries.filter((row) => row.userId === user.id).map((row) => row.libraryId),
      playlistIds: playlists.filter((row) => row.userId === user.id).map((row) => row.playlistId),
    }));
  }

  /**
   * Replaces the access grants of a user. Each list is only touched when provided.
   * Unknown ids are ignored.
   */
  private async setAccess(
    userId: string,
    access: { libraryIds?: string[]; playlistIds?: string[] },
  ): Promise<void> {
    if (access.libraryIds) {
      await UserLibraryModel.delete({ userId });
      const libraries = access.libraryIds.length
        ? await LibraryModel.findBy({ id: In(access.libraryIds) })
        : [];
      for (const library of libraries) {
        await UserLibraryModel.create({ userId, libraryId: library.id }).save();
      }
    }

    if (access.playlistIds) {
      await UserPlayListModel.delete({ userId });
      const playlists = access.playlistIds.length
        ? await PlayListModel.findBy({ id: In(access.playlistIds) })
        : [];
      for (const playlist of playlists) {
        await UserPlayListModel.create({ userId, playlistId: playlist.id }).save();
      }
    }
  }

  private async findSafeById(id: string): Promise<User> {
    const user = await UserModel.findOne({ where: { id }, select: { password: false } });
    if (!user) throw new NotFoundException(messages.errors.notFound.user);
    return user as unknown as User;
  }

  async delete(id: string): Promise<void> {
    const validatedId = this.validateId(id, 'User ID');
    await this.assertNotLastAdmin(validatedId);
    await this.helper.delete(validatedId);
  }

  /** Invalidates every token issued to the user (forced logout on all devices). */
  async revokeSessions(id: string): Promise<void> {
    const validatedId = this.validateId(id, 'User ID');
    const user = await UserModel.findOne({ where: { id: validatedId } });
    if (!user) throw new NotFoundException(messages.errors.notFound.user);
    await UserModel.update(validatedId, { tokenVersion: (user.tokenVersion ?? 0) + 1 });
  }

  /** Usernames are unique: answer 409 with a clear message instead of a database error. */
  private async assertUsernameAvailable(username?: string, exceptId?: string): Promise<void> {
    if (!username) return;
    const existing = await UserModel.findOne({ where: { username } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(messages.errors.conflict.usernameTaken);
    }
  }

  /** Removing or demoting the only administrator would leave the server unmanageable. */
  private async assertNotLastAdmin(id: string): Promise<void> {
    const user = await UserModel.findOne({ where: { id } });
    if (user?.type !== UserType.ADMIN) return;

    const admins = await UserModel.count({ where: { type: UserType.ADMIN } });
    if (admins <= 1) throw new ConflictException(messages.errors.conflict.lastAdmin);
  }
}
