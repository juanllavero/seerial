export interface UpdateWatchStateDTO {
  videoId: string;
  timeWatched: number;
  watched: boolean;
  /** @deprecated Ignored: the user always comes from the authentication token. */
  userId?: string;
}
