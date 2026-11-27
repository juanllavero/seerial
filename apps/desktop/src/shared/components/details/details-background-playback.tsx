import { getSignedVideoStreamUrlPassthrough } from '@seerial/api';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import DetailsBackgroundAudioPlayer from '@/shared/components/details/details-background-audio-player';
import DetailsBackgroundVideoPlayer from '@/shared/components/details/details-background-video-player';

type PlaybackMode = 'none' | 'audio' | 'video';

function normalizeLocalIds(localIds: Array<string | null | undefined>): string[] {
  return Array.from(new Set(localIds.filter((value): value is string => Boolean(value))));
}

/** Index of the first candidate with a theme video, -1 when none has one. */
async function findThemeVideoIndex(localIds: string[]): Promise<number> {
  for (const [index, localId] of localIds.entries()) {
    try {
      const signedUrl = await getSignedVideoStreamUrlPassthrough({
        filePath: 'none',
        localId,
        expiresIn: '10m',
      });
      if (signedUrl) return index;
    } catch {
      // No theme video for this candidate: try the next one
    }
  }
  return -1;
}

interface DetailsBackgroundPlaybackProps {
  audioLocalIds: Array<string | null | undefined>;
  videoLocalIds: Array<string | null | undefined>;
  onVideoVisibilityChange?: (isVisible: boolean) => void;
}

function DetailsBackgroundPlayback({
  audioLocalIds,
  videoLocalIds,
  onVideoVisibilityChange,
}: DetailsBackgroundPlaybackProps) {
  const audioCandidates = useMemo(() => normalizeLocalIds(audioLocalIds), [audioLocalIds]);
  const videoCandidates = useMemo(() => normalizeLocalIds(videoLocalIds), [videoLocalIds]);

  const audioCandidatesKey = audioCandidates.join('|');
  const videoCandidatesKey = videoCandidates.join('|');

  const [playbackState, setPlaybackState] = useState<{
    mode: PlaybackMode;
    audioIndex: number;
    videoIndex: number;
  }>({
    mode: 'none',
    audioIndex: 0,
    videoIndex: 0,
  });

  const { mode, audioIndex, videoIndex } = playbackState;

  // Picks what to play for new candidates (e.g. another season). Whether a theme video exists is
  // asked first, without touching what plays: switching to the video player to find out unmounted
  // the theme music and restarted it on every season change, even when it was the same song.
  useEffect(() => {
    let cancelled = false;

    void findThemeVideoIndex(videoCandidatesKey ? videoCandidatesKey.split('|') : []).then(
      (videoIndex) => {
        if (cancelled) return;
        if (videoIndex !== -1) {
          setPlaybackState({ mode: 'video', videoIndex, audioIndex: 0 });
          return;
        }
        // Same audio player instance when it was already playing: it keeps the song if unchanged
        setPlaybackState({
          mode: audioCandidatesKey ? 'audio' : 'none',
          audioIndex: 0,
          videoIndex: 0,
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [audioCandidatesKey, videoCandidatesKey]);

  const handleVideoUnavailable = useCallback(() => {
    onVideoVisibilityChange?.(false);

    setPlaybackState((currentState) => {
      if (currentState.videoIndex + 1 < videoCandidates.length) {
        return {
          ...currentState,
          videoIndex: currentState.videoIndex + 1,
        };
      }

      if (audioCandidates.length > 0) {
        return {
          ...currentState,
          audioIndex: 0,
          mode: 'audio',
        };
      }

      return {
        ...currentState,
        mode: 'none',
      };
    });
  }, [audioCandidates.length, onVideoVisibilityChange, videoCandidates.length]);

  const handleAudioUnavailable = useCallback(() => {
    setPlaybackState((currentState) => {
      if (currentState.audioIndex + 1 < audioCandidates.length) {
        return {
          ...currentState,
          audioIndex: currentState.audioIndex + 1,
        };
      }

      return {
        ...currentState,
        mode: 'none',
      };
    });
  }, [audioCandidates.length]);

  const handleVideoEnded = useCallback(() => {
    onVideoVisibilityChange?.(false);
    setPlaybackState((currentState) => ({
      ...currentState,
      mode: 'none',
    }));
  }, [onVideoVisibilityChange]);

  const activeAudioLocalId = audioCandidates[audioIndex];
  const activeVideoLocalId = videoCandidates[videoIndex];

  if (mode === 'video' && activeVideoLocalId) {
    return (
      <DetailsBackgroundVideoPlayer
        localId={activeVideoLocalId}
        onEnded={handleVideoEnded}
        onUnavailable={handleVideoUnavailable}
        onVisibilityChange={onVideoVisibilityChange}
      />
    );
  }

  if (mode === 'audio' && activeAudioLocalId) {
    return (
      <DetailsBackgroundAudioPlayer
        localId={activeAudioLocalId}
        onUnavailable={handleAudioUnavailable}
      />
    );
  }

  return null;
}

export default memo(DetailsBackgroundPlayback);
