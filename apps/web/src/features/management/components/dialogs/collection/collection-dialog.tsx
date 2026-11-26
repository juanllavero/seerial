import { API, seerialQueryClient, useGetCollection, useUpdate } from '@seerial/api';
import type { Collection, UpdateCollectionDTO } from '@seerial/domain';
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
import CollectionInfoTab from './components/collection-info-tab';

interface CollectionFormState {
  title: string;
  description: string;
  covers: string[];
  selectedCover: string;
  backgrounds: string[];
  selectedBackground: string;
}

function CollectionDialog() {
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
  const { data: collection } = useGetCollection(id);

  const [selectedTab, setSelectedTab] = useState<string | undefined>();
  const { update } = useUpdate<Collection>();

  const form = useFormState<CollectionFormState>({
    title: '',
    description: '',
    covers: [],
    selectedCover: '',
    backgrounds: [],
    selectedBackground: '',
  });
  const { resetFormState } = form;

  useEffect(() => {
    if (!collection) return;

    resetFormState({
      title: collection.title ?? '',
      description: collection.description ?? '',
      covers: collection.coversUrls ?? [],
      selectedCover: collection.coverSrc ?? '',
      backgrounds: collection.backgroundsUrls ?? [],
      selectedBackground: collection.backgroundSrc ?? '',
    });
    setSelectedTab(t('generalButton'));
  }, [collection, resetFormState, t]);

  if (!collection) return null;

  const handleEditCollection = async () => {
    await connectWS();

    // The server rejects any property that is not part of the DTO
    const response = await update(API.collections.update(collection.id), {
      title: form.title,
      description: form.description,
      coverSrc: form.selectedCover,
      backgroundSrc: form.selectedBackground,
    } satisfies UpdateCollectionDTO);

    if (!response) {
      showToast('error', 'Error updating collection');
      return;
    }

    seerialQueryClient.invalidateQueries();
    closeDialog();
  };

  const getWindowTitle = () => {
    return `${t('editButton')} ${collection.title}`;
  };

  return (
    <ModalWrapper
      title={getWindowTitle()}
      tabs={[
        {
          title: t('generalButton'),
          content: (
            <CollectionInfoTab
              title={form.title}
              setTitle={form.setTitle}
              description={form.description}
              setDescription={form.setDescription}
            />
          ),
        },
        {
          title: t('postersButton'),
          content: (
            <ImageListTab
              type={ImageType.POSTER}
              imagesList={form.covers}
              artwork={{ owner: 'collection', id: collection.id, field: 'coverSrc' }}
              selectImage={form.setSelectedCover}
              selectedImage={form.selectedCover}
            />
          ),
        },
        {
          title: t('backgroundsButton'),
          content: (
            <ImageListTab
              imagesList={form.backgrounds}
              artwork={{ owner: 'collection', id: collection.id, field: 'backgroundSrc' }}
              selectImage={form.setSelectedBackground}
              selectedImage={form.selectedBackground}
            />
          ),
        },
      ]}
      width="50rem"
      isOpen={true}
      close={closeDialog}
      onAccept={handleEditCollection}
      activeTab={selectedTab}
      onTabChange={setSelectedTab}
    />
  );
}

export default CollectionDialog;
