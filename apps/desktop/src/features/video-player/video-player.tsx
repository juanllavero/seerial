import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import type { Episode, Video } from '@seerial/domain';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ChapterList from '@/features/video-player/components/chapter-list';
import Controls from '@/features/video-player/components/controls/controls';
import VolumeIndicator from '@/features/video-player/components/controls/volume-slider';
import NextEpisodeCard from '@/features/video-player/components/next-episode-card';
import {
  useChapterThumbnails,
  usePlaybackPosition,
} from '@/features/video-player/hooks/use-chapter-thumbnails';
import { useMpvPlayer } from '@/features/video-player/hooks/use-mpv-player';
import { usePlayerSettings } from '@/features/video-player/hooks/use-player-settings';
import type { TrackSelection } from '@/features/video-player/hooks/use-track-selection';
import { useVolumeIndicator } from '@/features/video-player/hooks/use-volume-indicator';
import { normalizeChapters } from '@/features/video-player/utils/chapters';
import { NavigationContainer } from '@/shared/components/navigation';
import FlexBox from '@/shared/components/ui/flex-box';
import { useIdleCursor } from '@/shared/hooks/use-idle-cursor';
import { useKeyboardBack } from '@/shared/hooks/use-keyboard-back';
import { usePlayerControlsVisibility } from '@/shared/hooks/use-player-controls-visibility';
import { NavigationFocusKeys } from '@/shared/navigation/constants';

interface VideoPlayerProps {
  video: Video;
  trackSelection: TrackSelection;
  onSeekCommitted?: (position: number) => void;
  nextEpisode?: Episode | null;
  onPlayNext?: () => void;
}

/** The next episode is offered when this many seconds of the video are left. */
const NEXT_EPISODE_SECONDS_LEFT = 90;
const PROGRESS_POLL_INTERVAL_MS = 1000;

/** Whether `secondsLeft` or less of the video remain (polled only while `enabled`). */
function usePlaybackNearEnd(enabled: boolean, secondsLeft: number) {
  const mpv = useMpvPlayer();
  const [isNearEnd, setIsNearEnd] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsNearEnd(false);
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const { position, duration } = await mpv.getPlaybackStatus();
        if (typeof position === 'number' && typeof duration === 'number' && duration > 0) {
          setIsNearEnd(duration - position <= secondsLeft);
        }
      } catch {
        // mpv may be reloading: keep the last known state
      }
    }, PROGRESS_POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [enabled, secondsLeft, mpv.getPlaybackStatus]);

  return isNearEnd;
}

export default function VideoPlayer({
  video,
  trackSelection,
  onSeekCommitted,
  nextEpisode,
  onPlayNext,
}: VideoPlayerProps) {
  const [isTimelineFocused, setIsTimelineFocused] = useState(false);
  const [tracksPanelOpen, setTracksPanelOpen] = useState(false);
  const [chaptersExpanded, setChaptersExpanded] = useState(false);

  const { t } = useTranslation();
  const mpv = useMpvPlayer();
  const playerInputEnabled = !tracksPanelOpen;

  const { settings, updateSetting } = usePlayerSettings();
  const { volume, visible: volumeVisible } = useVolumeIndicator({
    enabled: playerInputEnabled,
  });

  const hasChapters = !!video.chapters?.length;
  const chapterThumbnails = useChapterThumbnails(video.id, hasChapters);
  const chapters = normalizeChapters(chapterThumbnails ?? video.chapters ?? [], (number) =>
    t('chapterNumber', { number }),
  );
  const position = usePlaybackPosition(hasChapters && chapters.length > 0);

  // Handle back navigation with a pre-action to stop the video before navigating back
  useKeyboardBack({
    preAction: () => {
      void mpv.stop();
      void mpv.embedMpv();
    },
    enabled: playerInputEnabled,
  });

  const handleTogglePlayPause = useCallback(() => {
    void mpv.togglePlayPause();
  }, [mpv.togglePlayPause]);

  const handleResumeIfPaused = useCallback(() => {
    void mpv.play();
  }, [mpv.play]);

  const isNearEnd = usePlaybackNearEnd(!!nextEpisode, NEXT_EPISODE_SECONDS_LEFT);
  const canPlayNext = !!nextEpisode && !!onPlayNext && isNearEnd && !tracksPanelOpen;

  // Only called while the controls are hidden, which is when the card is on screen
  const handleHiddenConfirm = useCallback(() => {
    if (!canPlayNext) return false;
    onPlayNext?.();
    return true;
  }, [canPlayNext, onPlayNext]);

  const { mode, isVisible } = usePlayerControlsVisibility({
    isTimelineFocused,
    enabled: playerInputEnabled,
    onTogglePlayPause: handleTogglePlayPause,
    onResumeIfPaused: handleResumeIfPaused,
    onHiddenConfirm: handleHiddenConfirm,
  });

  // Only over the bare video: the controls take the same space
  const showNextEpisode = canPlayNext && !isVisible;

  useIdleCursor();

  // Set initial focus on the timeline when controls become fully visible
  const isFull = mode === 'full';
  const isCompact = mode === 'compact';
  useEffect(() => {
    if (isFull || isCompact) {
      setFocus(NavigationFocusKeys.player.timeline);
    }
  }, [isFull, isCompact]);

  useEffect(() => {
    if (!isVisible) {
      setChaptersExpanded(false);
    }
  }, [isVisible]);

  const handleTimelineFocusChange = useCallback((focused: boolean) => {
    setIsTimelineFocused(focused);
  }, []);

  const handleTracksPanelChange = useCallback((open: boolean) => {
    setTracksPanelOpen(open);
  }, []);

  const handleChaptersExpand = useCallback(() => {
    setChaptersExpanded(true);
  }, []);

  const handleChaptersCollapse = useCallback(() => {
    setChaptersExpanded(false);
  }, []);

  const showChapters = chapters.length > 0 && isVisible;

  return (
    <NavigationContainer customFocusKey={NavigationFocusKeys.player.container}>
      <VolumeIndicator volume={volume} visible={volumeVisible} />
      {!!nextEpisode && !!onPlayNext && (
        <NextEpisodeCard episode={nextEpisode} visible={showNextEpisode} onPlay={onPlayNext} />
      )}
      <FlexBox
        className="absolute w-full h-full overflow-hidden"
        css={{
          backgroundColor: isVisible ? 'rgba(0, 0, 0, 0.8)' : 'transparent',
          transition: 'background-color 0.3s ease',
        }}
        width={'100%'}
        height={'100%'}
        justify="end"
        direction="column"
      >
        <FlexBox
          width={'100%'}
          padding="1rem"
          justify="center"
          align="center"
          css={{
            background: isVisible
              ? 'linear-gradient(to top, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.8) 3%, rgba(0, 0, 0, 0.5) 50%, rgba(0, 0, 0, 0.3) 70%, rgba(0, 0, 0, 0) 100%)'
              : 'transparent',
            visibility: isVisible ? 'visible' : 'hidden',
            pointerEvents: isVisible ? 'auto' : 'none',
          }}
        >
          <Controls
            video={video}
            trackSelection={trackSelection}
            controlsMode={mode}
            onSeekCommitted={onSeekCommitted}
            onTimelineFocusChange={handleTimelineFocusChange}
            onTracksPanelChange={handleTracksPanelChange}
            settings={settings}
            updateSetting={updateSetting}
          />
        </FlexBox>

        {showChapters && (
          <div
            className="w-full overflow-hidden transition-all duration-500 ease-in-out"
            style={{
              maxHeight: chaptersExpanded ? '32vh' : '4vh',
              background: 'rgba(0,0,0,0.95)',
              pointerEvents: isVisible ? 'auto' : 'none',
            }}
          >
            <div className="pb-4">
              <ChapterList
                chapters={chapters}
                position={position}
                isExpanded={chaptersExpanded}
                onExpand={handleChaptersExpand}
                onCollapse={handleChaptersCollapse}
                onSeekCommitted={onSeekCommitted}
              />
            </div>
          </div>
        )}
      </FlexBox>
    </NavigationContainer>
  );
}
