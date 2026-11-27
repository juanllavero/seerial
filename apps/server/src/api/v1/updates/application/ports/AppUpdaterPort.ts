import type { ServerUpdateStatus } from '@seerial/domain';

/**
 * Self-update of the packaged server (+ the web it serves). New versions are downloaded in the
 * background; installing one (restarting the server) is always an admin decision.
 */
export interface AppUpdaterPort {
  /** Starts checking now and periodically. No-op in development builds. */
  start(): void;
  getStatus(): ServerUpdateStatus;
  /** Closes the server, installs the downloaded version and starts it again. */
  install(): Promise<void>;
}
