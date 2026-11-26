import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useGetPlaylists } from '@seerial/api';
import { type LibraryItem, LibraryTypes, type PlayList } from '@seerial/domain';
import type { TFunction } from 'i18next';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { LibraryContent } from '@/features/library-content';
import Loading from '@/shared/components/loading';
import { useKeyboardBack } from '@/shared/hooks/use-keyboard-back';
import { NavigationFocusKeys } from '@/shared/navigation/constants';

/** Playlists are shown with the same grid of cards as the rest of the library content. */
function toLibraryItem(playlist: PlayList, index: number, t: TFunction): LibraryItem {
  const songCount = playlist.songs?.length ?? 0;
  const songCountLabel = t('songCount', { count: songCount });

  return {
    id: playlist.id,
    title: playlist.title,
    years: songCountLabel,
    coverSrc: playlist.images?.[0] ?? '',
    images: playlist.images,
    numberOfItems: songCount,
    order: index,
    watched: false,
    remainingItems: 0,
    analyzingFiles: false,
    type: 'playlist',
    details: {
      title: playlist.title,
      subtitle: songCountLabel,
      genres: '',
      description: playlist.description ?? '',
      coverSrc: playlist.images?.[0] ?? '',
    },
  };
}

function PlaylistsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedElement, setSelectedElement] = useState<LibraryItem | null>(null);

  const { data: playlists, isLoading } = useGetPlaylists<PlayList[]>({
    staleTime: 30_000,
  });

  const content = useMemo(
    () => (playlists ?? []).map((playlist, index) => toLibraryItem(playlist, index, t)),
    [playlists, t],
  );
  const contentIds = useMemo(() => new Set(content.map((item) => item.id)), [content]);

  const handleBack = useCallback(() => {
    const currentFocusKey = getCurrentFocusKey();

    if (currentFocusKey && contentIds.has(currentFocusKey)) {
      setFocus(NavigationFocusKeys.topBar.container);
      return;
    }

    navigate('/home');
  }, [contentIds, navigate]);

  useKeyboardBack({
    enabled: !isLoading,
    navigateOnBack: false,
    preAction: handleBack,
  });

  if (isLoading) {
    return <Loading />;
  }

  if (content.length === 0) {
    return <span>{t('noPlaylists')}</span>;
  }

  return (
    <LibraryContent
      content={content}
      libraryType={LibraryTypes.MUSIC}
      selectedElement={selectedElement}
      setSelectedElement={setSelectedElement}
      scrollMode="center"
    />
  );
}

export default memo(PlaylistsPage);
