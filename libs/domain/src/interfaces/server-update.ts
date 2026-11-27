/**
 * - unsupported: development build or platform without updates (nothing is shown)
 * - idle: up to date
 * - downloading: a new version is being downloaded in the background
 * - ready: downloaded, waiting for an admin to install it
 * - installing: the server is closing to install it and will start again
 */
export type ServerUpdateState =
  | "unsupported"
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

/** State of the server self-update, sent by GET /updates and the SERVER_UPDATE websocket message. */
export interface ServerUpdateStatus {
  state: ServerUpdateState;
  currentVersion: string;
  /** Version available (downloading / ready / installing). */
  version?: string;
  /** Changes of the new version, one per line ("- ..."). */
  notes?: string;
  /** Download progress, 0-100. */
  progress?: number;
  error?: string;
}
