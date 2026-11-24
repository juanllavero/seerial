import type { UserType } from '@/utils/constants';

export interface LoginDTO {
  username: string;
  password: string;
}

export interface LoginResponseDTO {
  user: UserDTO | null;
  token?: string;
  error?: string;
}

export interface CreateUserDTO {
  username: string;
  password?: string;
  avatar?: string;
  allowRemote?: boolean;
  type?: UserType;
  allowVideoTranscoding?: boolean;
  internetBitrateLimit?: number;
  allowDownloads?: boolean;
  hideInLogin?: boolean;
  maxSessions?: number;
  /** Libraries (read-only) the user can access. Ignored for admins, who access everything. */
  libraryIds?: string[];
  /** Non folder-based playlists (read-only) the user can access. */
  playlistIds?: string[];
}

export interface UpdateUserDTO {
  username?: string;
  password?: string;
  avatar?: string;
  allowRemote?: boolean;
  type?: UserType;
  allowVideoTranscoding?: boolean;
  internetBitrateLimit?: number;
  allowDownloads?: boolean;
  hideInLogin?: boolean;
  maxSessions?: number;
  /** Replaces the libraries the user can access. */
  libraryIds?: string[];
  /** Replaces the playlists the user can access. */
  playlistIds?: string[];
}

export interface UserDTO {
  id: string;
  username: string;
  avatar?: string;
  allowRemote: boolean;
  type: string;
  allowVideoTranscoding: boolean;
  internetBitrateLimit?: number;
  allowDownloads: boolean;
  hideInLogin: boolean;
  maxSessions: number;  /** Only returned by the admin user listing. */
  libraryIds?: string[];
  playlistIds?: string[];
}
