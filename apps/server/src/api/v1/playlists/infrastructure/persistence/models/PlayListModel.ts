import {
  BaseEntity,
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LibraryModel } from '@/api/v1/libraries/infrastructure/persistence/models/LibraryModel';
import { PlayListItemModel } from './PlayListItemModel';

@Entity({ name: 'PlayList' })
export class PlayListModel extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', nullable: false })
  id!: string;

  // Empty for playlists created from a library folder (shared by all users)
  @Column({ type: 'varchar', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  libraryId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  folder!: string | null;

  @ManyToOne(() => LibraryModel, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'library_id' })
  library!: LibraryModel | null;

  @Column({ type: 'varchar', nullable: false })
  title!: string;

  /** False: songs are listed alphabetically. True: songs follow the manual `position` order. */
  @Column({ type: 'boolean', nullable: false, default: false })
  customOrder!: boolean;

  @Column({ type: 'varchar', nullable: true, default: '' })
  description?: string;

  @Column({ type: 'varchar', nullable: true, default: '' })
  coverSrc?: string;

  @OneToMany(
    () => PlayListItemModel,
    (item) => item.playList,
    {
      cascade: true,
    },
  )
  items!: PlayListItemModel[];

  // Lifecycle hooks
  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4().split('-')[0];
    }
  }
}
