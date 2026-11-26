import { LibraryTypes, type DropdownContent, type DropdownItem, type LibraryItem, type LibraryType } from '@seerial/domain';
import type { NavigateFunction } from 'react-router-dom';
import type { DialogName, DialogPayloads } from '@/features/management';

interface SelectionActions {
  selectSeries: (id: string) => void;
  selectMovie: (id: string) => void;
  selectAlbum: (id: string) => void;
  selectCollection: (id: string) => void;
}

interface CardPresentation {
  aspectRatio: number;
  errorSrc: string;
  imgSrc: string;
  cornerNumber?: number;
}

interface MenuActions {
  refreshMetadata: (type: 'show' | 'movie', id: string) => void;
  toggleMovieWatched: (movieId: string, watched: boolean, userId: string) => void;
  toggleSeriesWatched: (seriesId: string, watched: boolean, userId: string) => void;
}

/** Library item types the web client knows how to open (playlists are desktop only). */
type WebItemType = Exclude<LibraryItem['type'], 'playlist'>;

type OpenDialog = <T extends DialogName>(name: T, payload: DialogPayloads[T]) => void;
type Translate = (key: string) => string;

interface MenuOptions {
  item: LibraryItem;
  t: Translate;
  userId?: string;
  /** Removing from the library is an administrator action. */
  isAdmin?: boolean;
  openDialog: OpenDialog;
  actions: MenuActions;
}

export function getCardPresentation(item: LibraryItem, libraryType: LibraryType): CardPresentation {
  const isMusic = libraryType === LibraryTypes.MUSIC;
  const errorSrc = isMusic ? '/img/songDefault.png' : '/img/fileNotFound.jpg';

  return {
    aspectRatio: isMusic ? 1 : 2 / 3,
    errorSrc,
    imgSrc: item.type === 'collection' && item.images && item.images.length > 0 ? item.images[0] : (item.coverSrc && item.coverSrc !== '' ? item.coverSrc : errorSrc),
    cornerNumber: item.type === 'series' ? item.remainingItems : undefined,
  };
}

export function createMediaCardAction(
  item: LibraryItem,
  libraryType: LibraryType,
  navigate: NavigateFunction,
  actions: SelectionActions,
  libraryId: string,
) {
  // Playlists only exist in the desktop client
  const navigationByType: Record<
    WebItemType,
    { select: (id: string) => void; path: string }
  > = {
    collection: {
      select: actions.selectCollection,
      path: `/collection/${item.id}/${libraryType}`,
    },
    series: {
      select: actions.selectSeries,
      path: `/library/${libraryId}/series/${item.id}`,
    },
    movie: {
      select: actions.selectMovie,
      path: `/library/${libraryId}/movie/${item.id}`,
    },
    album: {
      select: actions.selectAlbum,
      path: `/library/${libraryId}/album/${item.id}`,
    },
  };

  const navigation = navigationByType[item.type as WebItemType];

  return () => {
    navigation.select(item.id);
    navigate(navigation.path);
  };
}

const DELETE_DIALOG_BY_TYPE: Record<WebItemType, 'deleteSeries' | 'deleteMovie' | 'deleteAlbum' | 'deleteCollection'> = {
  series: 'deleteSeries',
  movie: 'deleteMovie',
  album: 'deleteAlbum',
  collection: 'deleteCollection',
};

export function createMediaCardMenuContent({ item, t, userId, isAdmin, openDialog, actions }: MenuOptions) {
  const isSeries = item.type === 'series';
  const isMovie = item.type === 'movie';
  const isAlbum = item.type === 'album';
  const isSeriesOrMovie = isSeries || isMovie;
  const mediaActions: DropdownItem[] = [];

  if (isSeries || isMovie || isAlbum) {
    mediaActions.push({
      title: t('updateMetadata'),
      action: () => {
        if (isSeries) {
          actions.refreshMetadata('show', item.id);
          return;
        }

        if (isMovie) {
          actions.refreshMetadata('movie', item.id);
          return;
        }

        console.log('Update metadata');
      },
    });
  }

  if (isSeriesOrMovie) {
    mediaActions.push({
      title: t('correctIdentification'),
      action: () =>
        openDialog('identification', {
          seriesId: isSeries ? item.id : undefined,
          movieId: isMovie ? item.id : undefined,
        }),
    });
  }

  if (isSeries) {
    mediaActions.push({
      title: t('changeEpisodesGroup'),
      action: () => openDialog('episodesGroup', { seriesId: item.id }),
    });
  }

  if (isSeriesOrMovie) {
    mediaActions.push({
      title: item.watched ? t('markUnwatched') : t('markWatched'),
      action: () => {
        if (!userId) {
          return;
        }

        if (isSeries) {
          actions.toggleSeriesWatched(item.id, !item.watched, userId);
          return;
        }

        actions.toggleMovieWatched(item.id, !item.watched, userId);
      },
    });
  }

  const deleteDialog = DELETE_DIALOG_BY_TYPE[item.type as WebItemType];
  const removeGroup =
    isAdmin && deleteDialog
      ? [
          { separator: true, items: [] },
          {
            separator: false,
            items: [
              {
                title: t('removeButton'),
                action: () => openDialog(deleteDialog, { id: item.id }),
              },
            ],
          },
        ]
      : [];

  return {
    items: [
      {
        separator: false,
        items: mediaActions,
      },
      ...removeGroup,
    ],
  } satisfies DropdownContent;
}

export function openMediaCardEditDialog(item: LibraryItem, openDialog: OpenDialog) {
  const dialogByType: Record<WebItemType, 'collection' | 'series' | 'movie' | 'album'> = {
    collection: 'collection',
    series: 'series',
    movie: 'movie',
    album: 'album',
  };

  openDialog(dialogByType[item.type as WebItemType], { id: item.id });
}
