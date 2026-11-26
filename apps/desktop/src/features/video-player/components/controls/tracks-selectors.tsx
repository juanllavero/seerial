import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import type { AudioTrack, SubtitleTrack } from '@seerial/domain';
import { Captions, Check, Music2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigationButton } from '@/shared/components/navigation';
import { useKeyboardShortcut } from '@/shared/hooks/use-keyboard-shortcut';
import { NavigationFocusKeys } from '@/shared/navigation/constants';
import {
  getAudioFormat,
  getLanguageName,
  getSubtitleFormat,
  isForcedTrack,
} from '@/shared/utils/track-labels';
import type { TrackSelection } from '../../hooks/use-track-selection';
import PlayerMenu, { PLAYER_MENU_ROW_CLASS, scrollFocusedRowIntoView } from '../player-menu';

type SelectorPanel = 'audio' | 'subtitle';

const IMAGE_SUBTITLE_CODECS = ['HDMV_PGS_SUBTITLE', 'DVD_SUBTITLE'];
const SUBTITLE_NONE_FOCUS_KEY = 'subtitle-track-none';

function getTrackFocusKey(panel: SelectorPanel, trackId: number) {
  return `${panel}-track-${trackId}`;
}

function TrackItem({
  focusKey,
  label,
  detail,
  badges = [],
  isSelected,
  onClick,
}: {
  focusKey: string;
  label: string;
  detail?: string;
  badges?: string[];
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <NavigationButton
      variant="ghost"
      selected={isSelected}
      customKey={focusKey}
      className={`${PLAYER_MENU_ROW_CLASS} ${isSelected ? 'ring-2 ring-app-color' : ''}`}
      onClick={onClick}
      onFocus={() => scrollFocusedRowIntoView(focusKey)}
    >
      <div className="flex w-full items-center gap-[1.4dvh]">
        <div className="flex w-[2.4dvh] shrink-0 justify-center">
          {!!isSelected && <Check className="size-[2.4dvh]!" strokeWidth={3} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="block font-semibold text-[2dvh] leading-snug">{label}</div>
          {!!detail && (
            <div className="wrap-break-word mt-[0.3dvh] block text-[1.6dvh] leading-snug opacity-75">
              {detail}
            </div>
          )}
        </div>
        {badges.map((badge) => (
          <div
            key={badge}
            className="shrink-0 rounded-[0.6dvh] border border-current px-[0.7dvh] py-[0.2dvh] font-semibold text-[1.3dvh] uppercase opacity-80"
          >
            {badge}
          </div>
        ))}
      </div>
    </NavigationButton>
  );
}

function TracksSelectors({
  trackSelection,
  onPanelChange,
}: {
  trackSelection: TrackSelection;
  onPanelChange?: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [openPanel, setOpenPanel] = useState<SelectorPanel | null>(null);
  const {
    audioTracks,
    subtitleTracks,
    selectedAudio,
    selectedSubtitle,
    titles,
    chooseAudio,
    chooseSubtitle,
  } = trackSelection;

  const subtitleOptions = subtitleTracks.filter(
    (track) => !IMAGE_SUBTITLE_CODECS.includes(track.codec),
  );
  const hasAudioOptions = audioTracks.length > 1;
  // A single subtitle track is already a choice: that one or none
  const hasSubtitleOptions = subtitleOptions.length > 0;

  const closePanel = useCallback(() => {
    setOpenPanel((prev) => {
      if (prev) {
        const focusKey =
          prev === 'audio'
            ? NavigationFocusKeys.player.audioTracksButton
            : NavigationFocusKeys.player.subtitleTracksButton;
        setTimeout(() => setFocus(focusKey), 30);
        onPanelChange?.(false);
      }
      return null;
    });
  }, [onPanelChange]);

  const togglePanel = (panel: SelectorPanel) => {
    const nextPanel = openPanel === panel ? null : panel;
    setOpenPanel(nextPanel);
    onPanelChange?.(nextPanel !== null);
  };

  // Row to focus when a menu opens (read only then, so later changes do not move the focus)
  const initialFocusKeyRef = useRef<string | undefined>(undefined);
  const audioFocusId = selectedAudio?.id ?? audioTracks[0]?.id;

  useEffect(() => {
    if (openPanel === 'audio') {
      initialFocusKeyRef.current =
        audioFocusId === undefined ? undefined : getTrackFocusKey('audio', audioFocusId);
    } else {
      initialFocusKeyRef.current = selectedSubtitle
        ? getTrackFocusKey('subtitle', selectedSubtitle.id)
        : SUBTITLE_NONE_FOCUS_KEY;
    }
  }, [openPanel, audioFocusId, selectedSubtitle]);

  useEffect(() => {
    if (!openPanel) return;

    const focusTimeout = window.setTimeout(() => {
      const focusKey = initialFocusKeyRef.current;
      if (!focusKey) return;
      setFocus(focusKey);
      scrollFocusedRowIntoView(focusKey);
    }, 30);

    return () => window.clearTimeout(focusTimeout);
  }, [openPanel]);

  // Close panel on Escape/Backspace
  useKeyboardShortcut({
    key: ['Escape', 'Backspace'],
    enabled: openPanel !== null,
    onKeyDown: useCallback(
      (e: KeyboardEvent) => {
        e.preventDefault();
        closePanel();
      },
      [closePanel],
    ),
  });

  if (!hasAudioOptions && !hasSubtitleOptions) {
    return null;
  }

  const renderAudioTrack = (track: AudioTrack) => (
    <TrackItem
      key={track.id}
      focusKey={getTrackFocusKey('audio', track.id)}
      label={getLanguageName(track, titles[track.id], i18n.language) || `${t('audio')} ${track.id}`}
      detail={titles[track.id]}
      badges={[
        getAudioFormat(track),
        ...(track.hasDolbyAtmos ? ['Atmos'] : []),
        ...(track.hasDtsX ? ['DTS:X'] : []),
      ].filter(Boolean)}
      isSelected={selectedAudio?.id === track.id}
      onClick={() => {
        closePanel();
        void chooseAudio(track);
      }}
    />
  );

  const renderSubtitleTrack = (track: SubtitleTrack) => {
    const title = track.title || titles[track.id];

    return (
      <TrackItem
        key={track.id}
        focusKey={getTrackFocusKey('subtitle', track.id)}
        label={getLanguageName(track, title, i18n.language) || `${t('subs')} ${track.id}`}
        detail={title}
        badges={[
          ...(isForcedTrack(track) ? [t('forcedTrack')] : []),
          getSubtitleFormat(track),
        ].filter(Boolean)}
        isSelected={selectedSubtitle?.id === track.id}
        onClick={() => {
          closePanel();
          void chooseSubtitle(track);
        }}
      />
    );
  };

  return (
    <div className="relative">
      <div className="flex items-center justify-end gap-2">
        {!!hasAudioOptions && (
          <NavigationButton
            variant="ghost"
            customKey={NavigationFocusKeys.player.audioTracksButton}
            title={t('audio')}
            className={`p-2 ${openPanel === 'audio' ? 'bg-white text-black' : ''}`}
            onClick={() => togglePanel('audio')}
          >
            <Music2 size={'2dvh'} />
          </NavigationButton>
        )}
        {!!hasSubtitleOptions && (
          <NavigationButton
            variant="ghost"
            customKey={NavigationFocusKeys.player.subtitleTracksButton}
            title={t('subs')}
            className={`p-2 ${openPanel === 'subtitle' ? 'bg-white text-black' : ''}`}
            onClick={() => togglePanel('subtitle')}
          >
            <Captions size={'2dvh'} />
          </NavigationButton>
        )}
      </div>

      <PlayerMenu
        open={openPanel !== null}
        title={openPanel === 'audio' ? t('audio') : t('subs')}
        onClose={closePanel}
      >
        {openPanel === 'audio' && audioTracks.map(renderAudioTrack)}
        {openPanel === 'subtitle' && (
          <>
            <TrackItem
              focusKey={SUBTITLE_NONE_FOCUS_KEY}
              label={t('none')}
              isSelected={selectedSubtitle === null}
              onClick={() => {
                closePanel();
                void chooseSubtitle(null);
              }}
            />
            {subtitleOptions.map(renderSubtitleTrack)}
          </>
        )}
      </PlayerMenu>
    </div>
  );
}

export default TracksSelectors;
