export interface UpdateSongDTO {
  title?: string;
  codec?: string;
  hasDolbyAtmos?: boolean;
  atmosFileSrc?: string | null;
  vocalsFileSrc?: string | null;
  instrumentalFileSrc?: string | null;
  trackNumber?: number;
  discNumber?: number;
  artists?: string[];
  composers?: string[];
  duration?: number;
  fileSrc?: string;
}

export interface LyricsResponse {
  message: string;
  path: string;
}

export interface SongUrlDTO {
  filePath: string;
  localId?: string;
  expiresIn?: number | string;
}

export interface SeparateSongStemsResponseDTO {
  jobId: string;
  songId: string;
  inputPath: string;
  instrumentalPath: string;
  vocalsPath: string;
  status: 'queued' | 'started' | 'processing' | 'completed' | 'error';
  message?: string;
  progress?: number;
}
