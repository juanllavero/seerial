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
import { AlbumModel } from '@/api/v1/albums/infrastructure/persistence/models/AlbumModel';
import { PlayListItemModel } from '@/api/v1/playlists/infrastructure/persistence/models/PlayListItemModel';

@Entity({ name: 'Song' })
export class SongModel extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', nullable: false })
  id!: string;

  @Column({ type: 'varchar', nullable: false })
  fileSrc!: string;

  @Column({ type: 'varchar', nullable: true })
  albumId!: string | null;

  @Column({ type: 'varchar', nullable: false, default: '' })
  title!: string;

  @Column({ type: 'integer', nullable: false, default: 0 })
  duration!: number;

  @Column({
    type: 'integer',
    nullable: false,
    default: 0,
  })
  trackNumber!: number;

  @Column({ type: 'integer', nullable: false, default: 0 })
  discNumber!: number;

  @Column({ type: 'boolean', nullable: true })
  hasDolbyAtmos!: boolean;

  // Dolby Atmos version of the song (name.atmos.ext), only when the original is not Atmos
  @Column({ type: 'varchar', nullable: true })
  atmosFileSrc!: string | null;

  @Column({ type: 'varchar', nullable: true })
  vocalsFileSrc!: string | null;

  @Column({ type: 'varchar', nullable: true })
  instrumentalFileSrc!: string | null;

  // Modification time (ms) of the original file the last time it was analyzed.
  // Null for songs scanned before it was tracked, which forces a re-analysis.
  @Column({ type: 'integer', nullable: true })
  fileModifiedAt!: number | null;

  @Column({ type: 'varchar', nullable: false, default: '' })
  codec!: string;

  @Column({ type: 'simple-json', nullable: false, default: '[]' })
  composers!: string[];

  @Column({ type: 'simple-json', nullable: false, default: '[]' })
  artists!: string[];

  @ManyToOne(() => AlbumModel, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'album_id' })
  album!: AlbumModel | null;

  @OneToMany(
    () => PlayListItemModel,
    (item) => item.song,
  )
  playListItems!: PlayListItemModel[];

  // Lifecycle hooks
  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4().split('-')[0];
    }
  }
}
