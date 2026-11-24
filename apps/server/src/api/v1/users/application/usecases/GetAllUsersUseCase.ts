import type { User } from '../../domain/User';
import type { UsersRepositoryPort } from '../ports/UsersRepositoryPort';

export class GetAllUsersUseCase {
  constructor(private usersRepo: UsersRepositoryPort) {}

  async execute(): Promise<User[]> {
    return await this.usersRepo.findAll();
  }

  /** All users (including hidden ones) with the libraries and playlists they can access. */
  async executeWithAccess() {
    return await this.usersRepo.findAllWithAccess();
  }
}
