import type { UsersRepositoryPort } from '../ports/UsersRepositoryPort';

export class RevokeUserSessionsUseCase {
  constructor(private usersRepo: UsersRepositoryPort) {}

  async execute(id: string): Promise<void> {
    return this.usersRepo.revokeSessions(id);
  }
}
