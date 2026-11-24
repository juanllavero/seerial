export interface StreamUrlDTO {
  filePath: string;
  localId?: string;
  start?: number;
  audio?: number;
  quality?: string;
  bitrate?: number;
  expiresIn?: number | string;
}

export interface VideoUrlDTO {
  filePath: string;
  localId?: string;
  /** Accepted for parity with the shared client request type; direct streaming ignores it. */
  start?: number;
  /** Accepted for parity with the shared client request type; direct streaming ignores it. */
  audio?: number;
  expiresIn?: number | string;
}
