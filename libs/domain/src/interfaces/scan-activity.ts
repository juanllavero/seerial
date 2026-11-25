/** Progress of the library scan that is running right now. */
export interface ScanProgress {
  libraryId: string;
  libraryName: string;
  /** Files analysed so far. */
  processed: number;
  /** Files to analyse in this library. */
  total: number;
}

/** Progress of the background music (themes) download of a library. */
export interface MusicDownloadProgress {
  libraryId: string;
  libraryName: string;
  completed: number;
  total: number;
}

/** What the server is doing in the background: scans and music downloads. */
export interface ScanActivity {
  scan: ScanProgress | null;
  music: MusicDownloadProgress | null;
  /** Scans waiting for the current one to finish. */
  queued: number;
}

export const SCAN_PERIODS = ["daily", "weekly", "monthly"] as const;
export type SmartScanPeriod = (typeof SCAN_PERIODS)[number];
