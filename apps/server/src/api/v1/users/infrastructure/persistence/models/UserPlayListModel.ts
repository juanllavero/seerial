import { BaseEntity, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PlayListModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListModel';
import { UserModel } from './UserModel';

/**
 * Read-only access granted by an admin to a (non folder-based) playlist.
 * Folder-based playlists are governed by access to their library instead.
 */
@Entity({ name: 'UserPlayList' })
export class UserPlayListModel extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', nullable: false })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', nullable: false })
  playlistId!: string;

  @ManyToOne(() => UserModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserModel;

  @ManyToOne(() => PlayListModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlist_id' })
  playlist?: PlayListModel;
}
