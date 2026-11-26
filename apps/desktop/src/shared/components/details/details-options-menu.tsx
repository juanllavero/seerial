import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useSetVideoTrackSelection } from '@seerial/api';
import type { PlayBackConfig, Video } from '@seerial/domain';
import {
  findPreferredSubtitleIndex,
  getAudioTrack,
  getSubtitleTrack,
  SUBTITLES_OFF,
} from '@seerial/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MenuRow from '@/shared/components/menus/menu-row';
import { useKeyboardBack } from '@/shared/hooks/use-keyboard-back';
import { NavigationFocusKeys } from '@/shared/navigation/constants';
import {
  formatAudioSummary,
  formatSubtitleSummary,
  getAudioFormat,
  getLanguageName,
  getSubtitleFormat,
  isForcedTrack,
} from '@/shared/utils/track-labels';

const MENU_FOCUS_KEY = 'details-options-menu';
const rowKey = (index: number) => `${MENU_FOCUS_KEY}-${index}`;

type MenuView = 'main' | 'audio' | 'subtitle';

export interface DetailsOptionsAction {
  label: string;
  run: () => Promise<void>;
}

interface DetailsOptionsMenuProps {
  title?: string;
  /** The video the track options act on. */
  video: Video | null | undefined;
  preferences: PlayBackConfig;
  actions?: DetailsOptionsAction[];
  /** The video with its new track choice, so the screen can show it at once. */
  onVideoChange: (video: Video) => void;
  onClose: () => void;
}

interface Row {
  label: string;
  detail?: string;
  badges?: string[];
  isSelected?: boolean;
  onClick: () => void;
}

/** "More options" menu of the movie and series details. */
function DetailsOptionsMenu({
  title,
  video,
  preferences,
  actions = [],
  onVideoChange,
  onClose,
}: DetailsOptionsMenuProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<MenuView>('main');
  const { mutate: saveSelection } = useSetVideoTrackSelection<
    void,
    { selectedAudioTrack?: number; selectedSubtitleTrack?: number }
  >(video?.id ?? '', {
    // The choice also applies to other episodes, and the player must not start from old data
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['videos', 'get'] });
      void queryClient.invalidateQueries({ queryKey: ['series'] });
      void queryClient.invalidateQueries({ queryKey: ['movies'] });
    },
  });
  const { ref, focusKey } = useFocusable({
    focusKey: MENU_FOCUS_KEY,
    trackChildren: true,
    isFocusBoundary: true,
  });

  const audioTracks = video?.audioTracks ?? [];
  const subtitleTracks = video?.subtitleTracks ?? [];
  const selectedAudio = video ? getAudioTrack(preferences.preferAudioLan, video) : null;
  const subtitle = video
    ? getSubtitleTrack(
        preferences.preferSubLan,
        preferences.subsMode,
        video,
        i18n.language,
        preferences.preferAudioLan,
      )
    : null;
  const selectedSubtitle = typeof subtitle === 'string' ? null : subtitle;

  const close = () => {
    onClose();
    setTimeout(() => setFocus(NavigationFocusKeys.details.optionsButton), 30);
  };

  const applySelection = (selection: { audio?: number; subtitle?: number }) => {
    if (!video) return;
    onVideoChange({
      ...video,
      ...(selection.audio !== undefined && { selectedAudioTrack: selection.audio }),
      ...(selection.subtitle !== undefined && { selectedSubtitleTrack: selection.subtitle }),
    });
    saveSelection({
      ...(selection.audio !== undefined && { selectedAudioTrack: selection.audio }),
      ...(selection.subtitle !== undefined && { selectedSubtitleTrack: selection.subtitle }),
    });
    close();
  };

  const mainRows: Row[] = [
    ...(audioTracks.length > 0
      ? [
          {
            label: t('selectAudioTrack'),
            detail: selectedAudio ? formatAudioSummary(selectedAudio, i18n.language) : undefined,
            onClick: () => setView('audio'),
          },
        ]
      : []),
    ...(subtitleTracks.length > 0
      ? [
          {
            label: t('selectSubtitleTrack'),
            detail: selectedSubtitle
              ? formatSubtitleSummary(selectedSubtitle, i18n.language, t('forcedTrack'))
              : t('none'),
            onClick: () => setView('subtitle'),
          },
        ]
      : []),
    ...actions.map((action) => ({
      label: action.label,
      onClick: () => {
        close();
        action.run().catch(console.error);
      },
    })),
  ];

  const audioRows: Row[] = audioTracks.map((track, index) => ({
    label: getLanguageName(track, undefined, i18n.language) || t('audio'),
    // Tracks of the same language are otherwise identical: tell them apart by their order
    detail: t('trackNumber', { number: index + 1 }),
    badges: [getAudioFormat(track)].filter(Boolean),
    isSelected: selectedAudio?.id === track.id,
    onClick: () => {
      // The subtitles depend on the audio: choose them again, as the player does
      const subtitleIndex = findPreferredSubtitleIndex(
        subtitleTracks,
        track,
        preferences,
        i18n.language,
      );
      applySelection({ audio: index, subtitle: subtitleIndex });
    },
  }));

  const subtitleRows: Row[] = [
    {
      label: t('none'),
      isSelected: !selectedSubtitle,
      onClick: () => applySelection({ subtitle: SUBTITLES_OFF }),
    },
    ...subtitleTracks.map((track, index) => ({
      label: getLanguageName(track, track.title, i18n.language) || t('subs'),
      detail: track.title || t('trackNumber', { number: index + 1 }),
      badges: [
        ...(isForcedTrack(track) ? [t('forcedTrack')] : []),
        getSubtitleFormat(track),
      ].filter(Boolean),
      isSelected: selectedSubtitle?.id === track.id,
      onClick: () => applySelection({ subtitle: index }),
    })),
  ];

  const rows = view === 'audio' ? audioRows : view === 'subtitle' ? subtitleRows : mainRows;
  const heading =
    view === 'audio' ? t('audio') : view === 'subtitle' ? t('subs') : (title ?? t('options'));
  const initialRow = Math.max(
    rows.findIndex((row) => row.isSelected),
    0,
  );

  // Focus the selected row (or the first one) every time the list shown changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: must also run when only the view changes
  useEffect(() => {
    const timeout = setTimeout(() => setFocus(rowKey(initialRow)), 30);
    return () => clearTimeout(timeout);
  }, [view]);

  useKeyboardBack({
    preAction: () => (view === 'main' ? close() : setView('main')),
    navigateOnBack: false,
    capture: true,
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes the menu on click
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard closes it with the back keys
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <FocusContext.Provider value={focusKey}>
        <div
          ref={ref as React.Ref<HTMLDivElement>}
          className="flex max-h-[76dvh] w-[min(68dvh,90vw)] flex-col overflow-hidden rounded-[2.4dvh] border border-white/15 bg-neutral-950 shadow-2xl"
        >
          <div className="truncate border-white/10 border-b px-[2.6dvh] py-[1.8dvh] font-semibold text-[2.6dvh] text-white">
            {heading}
          </div>
          <div className="min-h-0 overflow-y-auto p-[1.2dvh]">
            {rows.map((row, index) => (
              <MenuRow
                key={`${view}-${row.label}-${row.detail}`}
                focusKey={rowKey(index)}
                {...row}
              />
            ))}
          </div>
        </div>
      </FocusContext.Provider>
    </div>
  );
}

export default DetailsOptionsMenu;
