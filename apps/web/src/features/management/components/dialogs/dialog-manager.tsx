import { useDialogStore } from '../../stores/dialog-store';
import type { DialogType } from './dialog-registry';
import DynamicDialog from './dynamic-dialog';

function DialogManager() {
  const { open } = useDialogStore();

  const dialogs: DialogType[] = [
    'library',
    'collection',
    'manageCollections',
    'movie',
    'series',
    'season',
    'episode',
    'album',
    'deleteLibrary',
    'deleteSeries',
    'deleteMovie',
    'deleteSeason',
    'deleteEpisode',
    'deleteAlbum',
    'deleteSong',
    'deletePlaylist',
    'deleteCollection',
    'downloadMedia',
    'identification',
    'episodesGroup',
    'mediaInfo',
  ];

  return (
    <>
      {dialogs.map((type) => (
        <DynamicDialog key={type} type={type} isOpen={open === type} />
      ))}
    </>
  );
}

export default DialogManager;
