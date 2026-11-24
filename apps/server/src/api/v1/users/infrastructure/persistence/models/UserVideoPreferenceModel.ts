import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { VideoModel } from '@/api/v1/videos/infrastructure/persistence/models/VideoModel';
import { UserModel } from './UserModel';

/**
 * Audio/subtitle track a user picked for a video. It only affects that user:
 * the track stored in `Video` stays as the default for everybody else.
 */
@Entity({ name: 'UserVideoPreference' })
export class UserVideoPreferenceModel extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', nullable: false })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', nullable: false })
  videoId!: string;

  /** Index inside the video's audio tracks. */
  @Column({ type: 'integer', nullable: true })
  selectedAudioTrack!: number | null;

  /** Index inside the video's subtitle tracks; -1 means "no subtitles". */
  @Column({ type: 'integer', nullable: true })
  selectedSubtitleTrack!: number | null;

  @ManyToOne(() => UserModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserModel;

  @ManyToOne(() => VideoModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'video_id' })
  video?: VideoModel;
}
