export interface UpdateVideoDTO {
  title?: string;
  fileSrc?: string;
  runtime?: number;
  imgSrc?: string;
  imgUrls?: string[];
  selectedAudioTrack?: number;
  selectedSubtitleTrack?: number;
  extraType?: string;
  episodeId?: string;
  movieId?: string;
}

export interface SetVideoWatchStateDTO {
  watched: boolean;
  /** @deprecated Ignored: the user always comes from the authentication token. */
  userId?: string;
}

export interface SetVideoTrackSelectionDTO {
  /** Index of the audio track. */
  selectedAudioTrack?: number;
  /** Index of the subtitle track, or -1 for no subtitles. */
  selectedSubtitleTrack?: number;
}
