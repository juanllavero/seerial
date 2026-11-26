import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { API, apiClient, unwrapApiPayload, useGetLibraries } from '@seerial/api';
import { type Library, type LibraryItem, LibraryTypes } from '@seerial/domain';
import { useServerStore, useWebSocketStore } from '@seerial/stores';
import { useQueries } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { LibraryContent } from '@/features/library-content';
import Loading from '@/shared/components/loading';
import { useIsRestoringFocus } from '@/shared/hooks/use-is-restoring-focus';
import { useKeyboardBack } from '@/shared/hooks/use-keyboard-back';
import { NavigationFocusKeys } from '@/shared/navigation/constants';

/** The albums of every music library, in a single grid. */
function AlbumsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const serverUrl = useServerStore((state) => state.selectedServer?.url ?? '');
  const connectWS = useWebSocketStore((state) => state.connectWS);
  const [selectedElement, setSelectedElement] = useState<LibraryItem | null>(null);
  const isRestoringFocus = useIsRestoringFocus(selectedElement?.id);

  useEffect(() => {
    if (serverUrl) connectWS();
  }, [serverUrl, connectWS]);

  const { data: libraries, isLoading: isLoadingLibraries } = useGetLibraries<Library[]>({
    enabled: serverUrl !== '',
  });
  const musicLibraries = (libraries ?? []).filter((library) => library.type === LibraryTypes.MUSIC);

  // Same keys as `useGetLibraryContent`, so server updates refresh them too
  const { content, isLoadingContent } = useQueries({
    queries: musicLibraries.map((library) => ({
      queryKey: ['libraries', 'content', library.id, undefined],
      queryFn: async () => {
        const response = await apiClient.get<LibraryItem[]>(API.libraries.content(library.id));
        return unwrapApiPayload<LibraryItem[]>(response.data);
      },
    })),
    combine: (results) => ({
      content: results.flatMap((result) => result.data ?? []),
      isLoadingContent: results.some((result) => result.isLoading),
    }),
  });

  // Each library keeps its own order; several of them are merged by title
  const albums = useMemo(
    () =>
      musicLibraries.length > 1
        ? content.toSorted((a, b) => a.title.localeCompare(b.title))
        : content,
    [content, musicLibraries.length],
  );
  const albumIds = useMemo(() => new Set(albums.map((item) => item.id)), [albums]);
  const isLoading = isLoadingLibraries || isLoadingContent;

  const handleBack = useCallback(() => {
    const currentFocusKey = getCurrentFocusKey();

    if (currentFocusKey && albumIds.has(currentFocusKey)) {
      setFocus(NavigationFocusKeys.topBar.container);
      return;
    }

    navigate('/home');
  }, [albumIds, navigate]);

  useKeyboardBack({
    enabled: !isLoading,
    navigateOnBack: false,
    preAction: handleBack,
  });

  if (isLoading) {
    return <Loading />;
  }

  if (albums.length === 0) {
    return <span>{t('noAlbums')}</span>;
  }

  return (
    <LibraryContent
      content={albums}
      libraryType={LibraryTypes.MUSIC}
      selectedElement={selectedElement}
      setSelectedElement={setSelectedElement}
      scrollMode="center"
      isRestoringFocus={isRestoringFocus}
    />
  );
}

export default memo(AlbumsPage);
