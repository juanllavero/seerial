import type { MediaSearchResult } from '@seerial/domain';

export interface DownloaderServicePort {
  downloadYoutubeDownloader(): Promise<void>;
  /** Updates the yt-dlp binary to the latest release (it breaks when YouTube changes). */
  updateYoutubeDownloader(): Promise<void>;
  searchVideos(query: string, numberOfResults: number): Promise<MediaSearchResult[]>;
  downloadVideo(url: string, downloadFolder: string, fileName: string): Promise<void>;
  downloadAudio(url: string, downloadFolder: string, fileName: string): Promise<void>;
  /**
   * Queues the download of the first audio result of a search. When the download is for the
   * content of a library, it is reported in the progress of that library.
   */
  autoDownloadFirstAudioResult(
    query: string,
    elementId: string,
    library?: { id: string; name: string },
  ): Promise<void>;
}
