import { API, useGet } from '@seerial/api';
import type { Movie } from '@seerial/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';
import { ModalWrapper } from '@/shared/ui/modal-wrapper';
import SelectableWrapper from '@/shared/ui/selectable-wrapper';
import { useDialogStore } from '../../../stores/dialog-store';
import VideoMediaInfo from '../components/video-media-info';

const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

function MediaInfoDialog() {
  const { payload, closeDialog } = useDialogStore(
    (state) => ({ payload: state.payload, closeDialog: state.closeDialog }),
    shallow,
  );
  const { movieId } = payload as { movieId: string };
  const { data: movie } = useGet<Movie>(API.movies.get(movieId));
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!movie) return null;

  // A movie may have several files: versions or parts
  const videos = [...(movie.videos ?? [])].sort((a, b) => a.fileSrc.localeCompare(b.fileSrc));
  const video = videos.find((v) => v.id === selectedId) ?? videos[0];

  return (
    <ModalWrapper
      title={`${t('mediaInfo')}: ${movie.name}`}
      tabs={[
        {
          title: t('details'),
          content: video ? (
            <>
              {videos.length > 1 && (
                <div className="px-4 pt-2">
                  <SelectableWrapper
                    value={fileName(video.fileSrc)}
                    onValueChange={(id) => setSelectedId(id)}
                    options={videos.map((v) => ({ key: v.id, value: fileName(v.fileSrc) }))}
                  />
                </div>
              )}
              <VideoMediaInfo key={video.id} videoId={video.id} />
            </>
          ) : (
            <p className="p-4">{t('mediaInfoError')}</p>
          ),
        },
      ]}
      isOpen={true}
      close={closeDialog}
      hideButtons
    />
  );
}

export default MediaInfoDialog;
