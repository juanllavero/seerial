import type { User } from '../../domain/User';

export interface UsersRepositoryPort {
  findAll(): Promise<User[]>;
  authenticate(
    username: string,
    password: string | null,
  ): Promise<{ token: string; user: User | null } | null>;
  create(data: Partial<User> & { libraryIds?: string[]; playlistIds?: string[] }): Promise<User>;
  update(
    id: string,
    data: Partial<User> & { libraryIds?: string[]; playlistIds?: string[] },
  ): Promise<User>;
  findAllWithAccess(): Promise<(User & { libraryIds: string[]; playlistIds: string[] })[]>;
  delete(id: string): Promise<void>;
  revokeSessions(id: string): Promise<void>;
}
