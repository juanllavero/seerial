import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useGetLibraries } from '@seerial/api';
import { type Library, LibraryTypes } from '@seerial/domain';
import { useServerStore } from '@seerial/stores';
import { AnimatePresence, domAnimation, LazyMotion, m } from 'framer-motion';
import { Bookmark, ChevronUp, Search, Settings } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { SettingsPanel } from '@/features/settings';
import { NavigationButton, NavigationContainer } from '@/shared/components/navigation';
import { NavigationFocusKeys } from '@/shared/navigation/constants';
import LibrariesList, { type TopBarSubmenuItem } from './libraries-list';

const AUTO_OPEN_DELAY_MS = 1000;

const LIBRARY_TYPE_BUTTONS = {
  [LibraryTypes.MOVIES]: NavigationFocusKeys.topBar.movies,
  [LibraryTypes.SHOWS]: NavigationFocusKeys.topBar.shows,
  [LibraryTypes.MUSIC]: NavigationFocusKeys.topBar.music,
} as const;

const MUSIC_PATHS = ['/albums', '/playlists', '/details/playlist/', '/details/album/'];

function isMusicPath(pathname: string): boolean {
  return (
    pathname.split('/').pop() === LibraryTypes.MUSIC ||
    MUSIC_PATHS.some((path) => pathname.startsWith(path))
  );
}

function getActiveButtonKeyForPath(pathname: string): string {
  const segment = pathname.split('/').pop();

  if (segment === LibraryTypes.MOVIES) return NavigationFocusKeys.topBar.movies;
  if (segment === LibraryTypes.SHOWS) return NavigationFocusKeys.topBar.shows;
  if (isMusicPath(pathname)) return NavigationFocusKeys.topBar.music;
  if (pathname === '/search') return NavigationFocusKeys.topBar.search;
  if (pathname === '/see') return NavigationFocusKeys.topBar.toSee;

  return NavigationFocusKeys.topBar.home;
}

function TopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [showLibraries, setShowLibraries] = useState(false);
  const [libraryType, setLibraryType] = useState<LibraryTypes>(LibraryTypes.MOVIES);
  const [activeLibraryButtonKey, setActiveLibraryButtonKey] = useState<
    (typeof LIBRARY_TYPE_BUTTONS)[LibraryTypes]
  >(LIBRARY_TYPE_BUTTONS[LibraryTypes.MOVIES]);

  const [showSettings, setShowSettings] = useState(false);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setTimeout(() => setFocus(NavigationFocusKeys.topBar.settings), 30);
  }, []);

  const autoOpenTimeoutRef = useRef<number | null>(null);
  const focusToRestoreRef = useRef<string | null>(null);
  const preventNextAutoOpenFocusKeyRef = useRef<string | null>(null);
  const isInsideTopBarRef = useRef(false);

  const serverUrl = useServerStore((state) => state.selectedServer?.url ?? '');

  const { data: libraries } = useGetLibraries<Library[]>({
    enabled: serverUrl !== '',
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  function getLibrariesByType(type: LibraryTypes) {
    return libraries?.filter((library) => library.type === type) ?? [];
  }

  /** What is shown under a section: its libraries, or the two views of the music. */
  function getSubmenuItems(type: LibraryTypes): TopBarSubmenuItem[] {
    if (type === LibraryTypes.MUSIC) {
      return [
        { id: 'music-albums', label: t('albums'), path: '/albums' },
        { id: 'music-playlists', label: 'Playlists', path: '/playlists' },
      ];
    }

    return getLibrariesByType(type).map((library) => ({
      id: library.id,
      label: library.name,
      path: `/library/${library.id}/${type}`,
    }));
  }

  const moviesLibraries = getLibrariesByType(LibraryTypes.MOVIES);
  const seriesLibraries = getLibrariesByType(LibraryTypes.SHOWS);
  const albumsLibraries = getLibrariesByType(LibraryTypes.MUSIC);
  const submenuItems = getSubmenuItems(libraryType);

  const showMovies = moviesLibraries && moviesLibraries.length > 0;
  const showSeries = seriesLibraries && seriesLibraries.length > 0;
  const showMusic = albumsLibraries && albumsLibraries.length > 0;

  function clearAutoOpenTimeout() {
    if (autoOpenTimeoutRef.current) {
      window.clearTimeout(autoOpenTimeoutRef.current);
      autoOpenTimeoutRef.current = null;
    }
  }

  function openLibraries(nextType: LibraryTypes) {
    if (getSubmenuItems(nextType).length === 0) {
      return;
    }

    clearAutoOpenTimeout();
    setLibraryType(nextType);
    setShowLibraries(true);
  }

  function scheduleLibraryAutoOpen(nextType: LibraryTypes) {
    clearAutoOpenTimeout();
    if (getSubmenuItems(nextType).length <= 1) {
      return;
    }

    const focusKey = LIBRARY_TYPE_BUTTONS[nextType];

    if (preventNextAutoOpenFocusKeyRef.current === focusKey) {
      preventNextAutoOpenFocusKeyRef.current = null;
      return;
    }

    autoOpenTimeoutRef.current = window.setTimeout(() => {
      // Only open if focus is still on the same library type button
      if (getCurrentFocusKey() === focusKey) {
        openLibraries(nextType);
      }
    }, AUTO_OPEN_DELAY_MS);
  }

  function handleLibraryTypeFocus(nextType: LibraryTypes) {
    const focusKey = LIBRARY_TYPE_BUTTONS[nextType];

    setLibraryType(nextType);
    setActiveLibraryButtonKey(focusKey);

    if (showLibraries) {
      return;
    }

    scheduleLibraryAutoOpen(nextType);
  }

  function handleLibraryTypePress(nextType: LibraryTypes) {
    setActiveLibraryButtonKey(LIBRARY_TYPE_BUTTONS[nextType]);

    const items = getSubmenuItems(nextType);

    if (items.length === 1) {
      clearAutoOpenTimeout();
      navigate(items[0].path);
      return;
    }

    openLibraries(nextType);
  }

  function handleNonLibraryFocus() {
    clearAutoOpenTimeout();
  }

  function hideLibraries() {
    clearAutoOpenTimeout();
    preventNextAutoOpenFocusKeyRef.current = activeLibraryButtonKey;
    focusToRestoreRef.current = activeLibraryButtonKey;
    setShowLibraries(false);
  }

  function hideLibrariesWithoutFocusRestore() {
    clearAutoOpenTimeout();
    focusToRestoreRef.current = null;
    setShowLibraries(false);
  }

  const handleContainerFocus = useCallback(() => {
    if (isInsideTopBarRef.current) return;
    isInsideTopBarRef.current = true;
    setFocus(getActiveButtonKeyForPath(pathname));
  }, [pathname]);

  const handleContainerBlur = useCallback(() => {
    isInsideTopBarRef.current = false;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the items are rebuilt on every render
  useEffect(() => {
    if (!showLibraries) {
      if (focusToRestoreRef.current) {
        const focusKey = focusToRestoreRef.current;

        focusToRestoreRef.current = null;

        const focusFrame = window.requestAnimationFrame(() => {
          setFocus(focusKey);
        });

        return () => window.cancelAnimationFrame(focusFrame);
      }

      return;
    }

    // The view being shown, or the first one
    const target = submenuItems.find((item) => item.path === pathname) ?? submenuItems[0];

    if (!target) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      setFocus(target.id);
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, [submenuItems[0]?.id, showLibraries]);

  useEffect(() => {
    return () => {
      if (autoOpenTimeoutRef.current) {
        window.clearTimeout(autoOpenTimeoutRef.current);
        autoOpenTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <LazyMotion features={domAnimation}>
      <NavigationContainer
        customFocusKey={NavigationFocusKeys.topBar.container}
        className="relative flex justify-between items-center w-screen h-[8dvh] min-h-[8dvh] z-50"
        onFocus={handleContainerFocus}
        onBlur={handleContainerBlur}
      >
        <img src="/Seerial_logo.svg" alt="Logo" className="w-[5dvh] ml-10" />
        <div className="flex flex-1 justify-center">
          <AnimatePresence initial={false} mode="wait">
            {!showLibraries && (
              <m.div
                key="top-bar-actions"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="flex gap-6"
              >
                <NavigationButton
                  customKey={NavigationFocusKeys.topBar.home}
                  text={t('home')}
                  selected={pathname === '/home'}
                  onFocus={handleNonLibraryFocus}
                  onClick={() => navigate('/home')}
                  variant="ghost"
                />
                <NavigationButton
                  customKey={LIBRARY_TYPE_BUTTONS[LibraryTypes.MOVIES]}
                  disabled={!showMovies}
                  selected={pathname.split('/').pop() === LibraryTypes.MOVIES}
                  onFocus={() => handleLibraryTypeFocus(LibraryTypes.MOVIES)}
                  onClick={() => handleLibraryTypePress(LibraryTypes.MOVIES)}
                  text={t('movies')}
                  variant="ghost"
                />
                <NavigationButton
                  customKey={LIBRARY_TYPE_BUTTONS[LibraryTypes.SHOWS]}
                  disabled={!showSeries}
                  selected={pathname.split('/').pop() === LibraryTypes.SHOWS}
                  onFocus={() => handleLibraryTypeFocus(LibraryTypes.SHOWS)}
                  onClick={() => handleLibraryTypePress(LibraryTypes.SHOWS)}
                  text={t('shows')}
                  variant="ghost"
                />
                <NavigationButton
                  customKey={LIBRARY_TYPE_BUTTONS[LibraryTypes.MUSIC]}
                  disabled={!showMusic}
                  selected={isMusicPath(pathname)}
                  onFocus={() => handleLibraryTypeFocus(LibraryTypes.MUSIC)}
                  onClick={() => handleLibraryTypePress(LibraryTypes.MUSIC)}
                  text={t('music')}
                  variant="ghost"
                />
                <NavigationButton
                  customKey={NavigationFocusKeys.topBar.search}
                  selected={pathname === '/search'}
                  onFocus={handleNonLibraryFocus}
                  onClick={() => navigate('/search')}
                  variant="ghost"
                >
                  <Search size={'3dvh'} />
                </NavigationButton>
                <NavigationButton
                  customKey={NavigationFocusKeys.topBar.toSee}
                  selected={pathname === '/see'}
                  onFocus={handleNonLibraryFocus}
                  onClick={() => navigate('/see')}
                  variant="ghost"
                >
                  <Bookmark size={'3dvh'} />
                </NavigationButton>
              </m.div>
            )}
          </AnimatePresence>
        </div>
        <div>
          <NavigationButton
            customKey={NavigationFocusKeys.topBar.settings}
            onFocus={handleNonLibraryFocus}
            onClick={() => setShowSettings(true)}
            className="mr-10"
            variant="ghost"
          >
            <Settings size={'3dvh'} />
          </NavigationButton>
        </div>

        <SettingsPanel open={showSettings} onClose={closeSettings} />

        <AnimatePresence>
          {showLibraries && (
            <m.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2"
            >
              <ChevronUp className="text-white/80" size={'2.5dvh'} />
            </m.div>
          )}
        </AnimatePresence>

        <LibrariesList
          items={submenuItems}
          show={showLibraries}
          hide={hideLibraries}
          hideWithoutFocusRestore={hideLibrariesWithoutFocusRestore}
        />
      </NavigationContainer>
    </LazyMotion>
  );
}

export default memo(TopBar);
