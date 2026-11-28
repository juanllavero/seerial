import type { ArtworkEntity } from '@/api/v1/shared/infrastructure/services/artwork/ArtworkService';
import type { ArtworkSlot } from '@/api/v1/shared/infrastructure/services/artwork/artworkFiles';
import type {
  ThemeKind,
  ThemeOwner,
} from '@/api/v1/shared/infrastructure/services/artwork/themeMedia';
import type { MediaSearchResult } from '@seerial/domain';

export interface DownloaderServicePort {
  downloadYoutubeDownloader(): Promise<void>;
  /** Updates the yt-dlp binary to the latest release (it breaks when YouTube changes). */
  updateYoutubeDownloader(): Promise<void>;
  searchVideos(query: string, numberOfResults: number): Promise<MediaSearchResult[]>;
  /** Downloads a theme song or background video into its place */
  downloadThemeMedia(
    url: string,
    kind: ThemeKind,
    slot: ArtworkSlot,
    options: { overwrite: boolean; name: string; waitForCompletion?: boolean },
  ): Promise<void>;
  /**
   * Queues the download of the first audio result of a search. When the download is for the
   * content of a library, it is reported in the progress of that library.
   */
  autoDownloadFirstAudioResult(
    query: string,
    owner: ThemeOwner,
    entity: ArtworkEntity,
    library?: { id: string; name: string },
  ): Promise<void>;
}
