import { API, useDelete } from '@seerial/api';
import { API_ERROR_CODES } from '@seerial/domain';
import { useWebSocketStore } from '@seerial/stores';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { showToast } from '@/shared/lib/react-utils';
import AlertWrapper from '@/shared/ui/alert-wrapper';
import { useDialogStore } from '../../../stores/dialog-store';
import LocalSourceErrorAlert from './local-source-error-alert';

type DeleteDialogName =
  | 'deleteLibrary'
  | 'deleteSeries'
  | 'deleteMovie'
  | 'deleteSeason'
  | 'deleteEpisode'
  | 'deleteAlbum'
  | 'deleteSong'
  | 'deletePlaylist'
  | 'deleteCollection';

interface DeleteConfig {
  titleKey: string;
  descriptionKey: string;
  endpoint: (id: string) => string;
  navigateTo?: string;
  /** Message shown when the server refuses the deletion because the item comes from a local folder/file. */
  localSourceErrorKey?: string;
}

const deleteConfigMap: Record<DeleteDialogName, DeleteConfig> = {
  deleteLibrary: {
    titleKey: 'deleteLibrary',
    descriptionKey: 'deleteLibraryMessage',
    endpoint: (id) => API.libraries.delete(id),
    navigateTo: '/home',
  },
  deleteSeries: {
    titleKey: 'deleteSeries',
    descriptionKey: 'deleteSeriesMessage',
    endpoint: (id) => API.series.delete(id),
  },
  deleteMovie: {
    titleKey: 'deleteMovie',
    descriptionKey: 'deleteMovieMessage',
    endpoint: (id) => API.movies.delete(id),
  },
  deleteSeason: {
    titleKey: 'deleteSeason',
    descriptionKey: 'deleteSeasonMessage',
    endpoint: (id) => API.seasons.delete(id),
  },
  deleteEpisode: {
    titleKey: 'deleteEpisode',
    descriptionKey: 'deleteEpisodeMessage',
    endpoint: (id) => API.episodes.delete(id),
  },
  deleteAlbum: {
    titleKey: 'deleteAlbum',
    descriptionKey: 'deleteAlbumMessage',
    endpoint: (id) => API.albums.delete(id),
  },
  deleteSong: {
    titleKey: 'deleteSong',
    descriptionKey: 'deleteSongMessage',
    endpoint: (id) => API.songs.delete(id),
    localSourceErrorKey: 'localSourceDeleteErrorSong',
  },
  deletePlaylist: {
    titleKey: 'deletePlaylist',
    descriptionKey: 'deletePlaylistMessage',
    endpoint: (id) => API.playlists.delete(id),
    localSourceErrorKey: 'localSourceDeleteErrorPlaylist',
  },
  deleteCollection: {
    titleKey: 'deleteCollection',
    descriptionKey: 'deleteCollectionMessage',
    endpoint: (id) => API.collections.delete(id),
  },
};

function DeleteDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { deleteRequestWithResult } = useDelete();
  const connectWS = useWebSocketStore((state) => state.connectWS);
  const { open, payload, closeDialog } = useDialogStore();
  const [localSourceErrorKey, setLocalSourceErrorKey] = useState<string | null>(null);

  const dialogType = open as DeleteDialogName;
  const config = deleteConfigMap[dialogType];
  const { id } = payload as { id: string };

  if (localSourceErrorKey) {
    return <LocalSourceErrorAlert descriptionKey={localSourceErrorKey} onClose={closeDialog} />;
  }

  return (
    <AlertWrapper
      openDialog={true} // DynamicDialog manages it
      title={t(config.titleKey)}
      description={t(config.descriptionKey)}
      actionMessage={t('removeButton')}
      action={async () => {
        connectWS();
        const result = await deleteRequestWithResult(config.endpoint(id));

        if (
          !result.ok &&
          result.code === API_ERROR_CODES.LOCAL_SOURCE_DELETE_FORBIDDEN &&
          config.localSourceErrorKey
        ) {
          setLocalSourceErrorKey(config.localSourceErrorKey);
          return;
        }

        if (!result.ok) showToast('error', result.message || 'Error deleting item');

        await queryClient.invalidateQueries({ queryKey: ['crud'] });
        if (config.navigateTo) navigate(config.navigateTo);
        closeDialog();
      }}
      isDeleteAlert
      closeDialog={closeDialog}
    />
  );
}

export default DeleteDialog;
