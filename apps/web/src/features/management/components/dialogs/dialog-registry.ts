import { lazy } from 'react';
// Small and needed right when the user asks to remove something: loaded with the page instead of
// when the button is pressed, so the confirmation never waits for (or fails on) a download
import DeleteDialog from './delete/delete-dialog';

export const dialogRegistry = {
  library: lazy(() => import('./library/library-dialog')),

  collection: lazy(() => import('./collection/collection-dialog')),
  manageCollections: lazy(() => import('./manage-collections/manage-collections-dialog')),
  movie: lazy(() => import('./movie/movie-dialog')),
  series: lazy(() => import('./series/series-dialog')),
  season: lazy(() => import('./season/season-dialog')),
  episode: lazy(() => import('./episode/episode-dialog')),
  album: lazy(() => import('./album/album-dialog')),
  downloadMedia: lazy(() => import('./download-media/download-media-dialog')),
  identification: lazy(() => import('./identification/change-identification-dialog')),
  episodesGroup: lazy(() => import('./episodes-group/change-episodes-group-dialog')),
  deleteSeries: DeleteDialog,
  deleteMovie: DeleteDialog,
  deleteSeason: DeleteDialog,
  deleteEpisode: DeleteDialog,
  deleteAlbum: DeleteDialog,
  deleteSong: DeleteDialog,
  deletePlaylist: DeleteDialog,
  deleteCollection: DeleteDialog,
  deleteLibrary: DeleteDialog,
} as const;

export type DialogType = keyof typeof dialogRegistry;
