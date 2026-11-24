export interface CreatePlayListDTO {
  title: string;
  description?: string;
}

export interface UpdatePlayListDTO {
  title?: string;
  description?: string;
}

export interface AddSongToPlaylistDTO {
  songId: string;
}

export interface ReorderPlayListSongsDTO {
  /** Song ids in the desired order. Songs not listed keep their order after the listed ones. */
  orderedSongIds: string[];
}
