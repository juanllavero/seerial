import { API, seerialQueryClient, useGet, useUpdate } from '@seerial/api';
import type { Album, UpdateAlbumDTO } from '@seerial/domain';
import { useWebSocketStore } from '@seerial/stores';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';
import useFormState from '@/shared/hooks/use-form-state';
import { ImageType } from '@/shared/lib/constants';
import { showToast } from '@/shared/lib/react-utils';
import { ModalWrapper } from '@/shared/ui/modal-wrapper';
import { useDialogStore } from '../../../stores/dialog-store';
import ImageListTab from '../components/image-list-tab';
import AlbumInfoTab from './components/album-info-tab';

interface AlbumFormState {
  title: string;
  year: string;
  description: string;
  genres: string[];
  posters: string[];
  selectedPoster: string;
}

function AlbumDialog() {
  const { t } = useTranslation();
  const connectWS = useWebSocketStore((state) => state.connectWS);
  const { payload, closeDialog } = useDialogStore(
    (state) => ({
      payload: state.payload,
      closeDialog: state.closeDialog,
    }),
    shallow,
  );
  const { id } = payload as { id: string };
  const { data: album } = useGet<Album>(API.albums.get(id));

  const [selectedTab, setSelectedTab] = useState<string | undefined>();
  const { update } = useUpdate<Album>();

  const form = useFormState<AlbumFormState>({
    title: '',
    year: '',
    description: '',
    genres: [],
    posters: [],
    selectedPoster: '',
  });
  const { resetFormState } = form;

  useEffect(() => {
    if (!album) return;

    resetFormState({
      title: album.title ?? '',
      year: album.year ?? '',
      description: album.description ?? '',
      genres: album.genres ?? [],
      posters: album.coverSrc ? [album.coverSrc] : [],
      selectedPoster: album.coverSrc ?? '',
    });
    setSelectedTab(t('generalButton'));
  }, [album, resetFormState, t]);

  if (!album) return null;

  const handleEditAlbum = async () => {
    await connectWS();

    // The server rejects any property that is not part of the DTO
    const response = await update(API.albums.update(album.id), {
      title: form.title,
      year: form.year,
      description: form.description,
      coverSrc: form.selectedPoster ?? '',
      genres: form.genres,
    } satisfies UpdateAlbumDTO);

    if (!response) {
      showToast('error', 'Error updating album');
      return;
    }

    seerialQueryClient.invalidateQueries();
    closeDialog();
  };

  const getWindowTitle = () => {
    return `${t('editButton')} ${album.title}`;
  };

  return (
    <ModalWrapper
      title={getWindowTitle()}
      tabs={[
        {
          title: t('generalButton'),
          content: (
            <AlbumInfoTab
              title={form.title}
              setTitle={form.setTitle}
              year={form.year}
              setYear={form.setYear}
              description={form.description}
              setDescription={form.setDescription}
              genres={form.genres}
              setGenres={form.setGenres}
            />
          ),
        },
        {
          title: t('postersButton'),
          content: (
            <ImageListTab
              imagesList={form.posters}
              artwork={{ owner: 'album', id: album.id, field: 'coverSrc' }}
              selectImage={form.setSelectedPoster}
              selectedImage={form.selectedPoster}
              type={ImageType.SQUARE}
            />
          ),
        },
      ]}
      width="50rem"
      isOpen={true}
      close={closeDialog}
      onAccept={handleEditAlbum}
      activeTab={selectedTab}
      onTabChange={setSelectedTab}
    />
  );
}

export default AlbumDialog;
