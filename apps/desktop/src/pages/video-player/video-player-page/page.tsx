import {
  getSignedVideoStreamUrlPassthrough,
  useGetVideo,
  useUpdateVideoWatchState,
} from '@seerial/api';
import type { Video } from '@seerial/domain';
import { useServerStore } from '@seerial/stores';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useReducer, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useSeriesDetailsFocusStore } from '@/features/details/series/stores/series-details-focus.store';
import { VideoPlayer } from '@/features/video-player';
import { useMpvPlayer } from '@/features/video-player/hooks/use-mpv-player';
import { useNextEpisode } from '@/features/video-player/hooks/use-next-episode';
import { useTrackSelection } from '@/features/video-player/hooks/use-track-selection';
import { resolveResumePosition } from '@/features/video-player/utils/resume-position';
import AppAlertDialog from '@/shared/components/app-alert-dialog';
import {
  resetAppShellBackground,
  setAppShellBackground,
  waitForMpvCommands,
} from '@/shared/components/details/details-background-mpv';
import Loading from '@/shared/components/loading';
import { useKeyboardBack } from '@/shared/hooks/use-keyboard-back';
import { useSettingsStore } from '@/shared/stores/settings.store';
import { isGenuineEnd } from '@/shared/utils/playback-end';
import { useAppSettingsMpv } from '../../../features/video-player/hooks/use-app-settings-mpv';

/** A sleeping server disk can take a while to spin up: real failures are detected earlier. */
const LOAD_TIMEOUT_MS = 45000;
const PLAYER_HEALTH_POLL_INTERVAL_MS = 1000;
const MAX_PREMATURE_EOF_RETRIES = 3;
const RECOVERY_PROGRESS_SECONDS = 15;

type PlayerErrorMode = 'load' | 'playback';

interface PlayerViewState {
  videoLoaded: boolean;
  showInitialLoadingBackdrop: boolean;
  isErrorDialogOpen: boolean;
  errorMode: PlayerErrorMode;
  isRecoveringPlaybackError: boolean;
  isPlayerLoading: boolean;
  isPlaybackBuffering: boolean;
}

type PlayerViewAction = Partial<PlayerViewState>;

const INITIAL_PLAYER_VIEW_STATE: PlayerViewState = {
  videoLoaded: false,
  showInitialLoadingBackdrop: true,
  isErrorDialogOpen: false,
  errorMode: 'load',
  isRecoveringPlaybackError: false,
  isPlayerLoading: true,
  isPlaybackBuffering: false,
};

function playerViewReducer(state: PlayerViewState, action: PlayerViewAction): PlayerViewState {
  return { ...state, ...action };
}

function useVideoPlayerPageController({
  video,
  loadingVideo,
  serverUrl,
  currentUserId,
  navigate,
  fromStart,
  onPlaybackFinished,
  reapplyAppSettings,
}: {
  video?: Video;
  loadingVideo: boolean;
  serverUrl: string;
  currentUserId?: string;
  navigate: ReturnType<typeof useNavigate>;
  /** Ignore the saved progress. */
  fromStart: boolean;
  /** The video reached its real end (already marked as watched). */
  onPlaybackFinished?: () => void;
  /** Settings of the app for a freshly created mpv instance. */
  reapplyAppSettings: () => Promise<void>;
}) {
  const mpv = useMpvPlayer();
  const [playerViewState, setPlayerViewState] = useReducer(
    playerViewReducer,
    INITIAL_PLAYER_VIEW_STATE,
  );
  const {
    videoLoaded,
    showInitialLoadingBackdrop,
    isErrorDialogOpen,
    errorMode,
    isRecoveringPlaybackError,
    isPlayerLoading,
    isPlaybackBuffering,
  } = playerViewState;

  const lastKnownPositionRef = useRef(0);
  const completedFirstLoadAttemptRef = useRef(false);
  const healthCheckInFlightRef = useRef(false);
  const playbackRecoveryInFlightRef = useRef(false);
  const watchStateTrackedRef = useRef(false);
  const videoEndedTrackedRef = useRef(false);
  const currentVideoRef = useRef<Video | null>(null);
  const currentUserIdRef = useRef<string | undefined>(undefined);
  const lastSeekedAtRef = useRef(0);
  const prematureEofRetriesRef = useRef(0);
  // Last position seen while the video was actually playing (never the EOF jump of a failed seek)
  const lastPlayingPositionRef = useRef(0);
  const lastRecoveryPositionRef = useRef(0);
  // Set once playback was handed over to another video: nothing may touch mpv any more
  const leavingRef = useRef(false);
  const onPlaybackFinishedRef = useRef(onPlaybackFinished);
  onPlaybackFinishedRef.current = onPlaybackFinished;
  // Through a ref: a settings change must not reload the video
  const reapplyAppSettingsRef = useRef(reapplyAppSettings);
  reapplyAppSettingsRef.current = reapplyAppSettings;

  const queryClient = useQueryClient();
  // Details and home show the progress: also runs after leaving the player
  const { mutate: updateWatchState } = useUpdateVideoWatchState({
    onSuccess: () => {
      for (const queryKey of [['series'], ['movies'], ['libraries'], ['continueWatching']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const getInitialPlaybackPosition = useCallback(
    (videoToPlay: Video) => {
      if (fromStart) return 0;
      const watchList = videoToPlay.watchLists?.find((list) => list.userId === currentUserId);
      return resolveResumePosition(watchList?.timeWatched, videoToPlay.runtime);
    },
    [currentUserId, fromStart],
  );

  const getSignedStreamUrl = useCallback(
    async (videoToPlay: Video) => {
      const url = await getSignedVideoStreamUrlPassthrough({
        filePath: videoToPlay.fileSrc,
        expiresIn: '2m',
      });
      // The server answers with an empty URL when the file is unknown or not accessible
      if (!url) throw new Error('The server did not provide a stream URL for this video');
      return `${serverUrl}${url}`;
    },
    [serverUrl],
  );

  const loadVideo = useCallback(
    async (videoToPlay: Video, resumeAt = 0): Promise<boolean> => {
      setPlayerViewState({ isPlayerLoading: true, isPlaybackBuffering: false });

      try {
        const url = await getSignedStreamUrl(videoToPlay);
        const [_, ready] = await Promise.all([mpv.loadUrl(url), mpv.waitForReady(LOAD_TIMEOUT_MS)]);
        if (!ready) {
          throw new Error('Timed out waiting for video to become ready');
        }

        if (resumeAt > 0) {
          // A few seconds before or after the saved point is fine and saves a slow exact seek
          await mpv.seekToKeyframe(resumeAt);
        }

        // A previous EOF/error leaves mpv paused (keep-open): a (re)load must always start playing
        await mpv.play();

        lastKnownPositionRef.current = resumeAt;
        lastPlayingPositionRef.current = resumeAt;
        setPlayerViewState({
          videoLoaded: true,
          isPlayerLoading: false,
          isErrorDialogOpen: false,
          isRecoveringPlaybackError: false,
        });
        return true;
      } catch (e) {
        console.error(e);
        setPlayerViewState({ isPlayerLoading: false, videoLoaded: false });
        return false;
      } finally {
        if (!completedFirstLoadAttemptRef.current) {
          completedFirstLoadAttemptRef.current = true;
          setPlayerViewState({ showInitialLoadingBackdrop: false });
        }
      }
    },
    [getSignedStreamUrl, mpv.loadUrl, mpv.waitForReady, mpv.seekToKeyframe, mpv.play],
  );

  useEffect(() => {
    void mpv.embedMpv();
  }, [mpv.embedMpv]);

  useEffect(() => {
    setAppShellBackground('transparent');

    return () => {
      resetAppShellBackground();
    };
  }, []);

  useEffect(() => {
    currentVideoRef.current = video ?? null;
    currentUserIdRef.current = currentUserId;
  }, [video, currentUserId]);

  useEffect(() => {
    if (!videoLoaded || !video || !currentUserId || watchStateTrackedRef.current) {
      return;
    }

    watchStateTrackedRef.current = true;

    updateWatchState({
      videoId: video.id,
      timeWatched: lastKnownPositionRef.current,
      watched: false,
    });
  }, [videoLoaded, video, currentUserId, updateWatchState]);

  useEffect(() => {
    if (!video || !serverUrl) {
      return;
    }

    let cancelled = false;

    const loadInitialVideo = async () => {
      // The same page plays the next episode: nothing of the previous video may carry over
      watchStateTrackedRef.current = false;
      videoEndedTrackedRef.current = false;
      prematureEofRetriesRef.current = 0;
      lastRecoveryPositionRef.current = 0;
      setPlayerViewState({ videoLoaded: false });

      // The theme music of the page we come from may still be fading out and stopping mpv
      await waitForMpvCommands();
      if (cancelled) return;
      // Its stop recreated mpv after this page applied the app settings: apply them again
      await reapplyAppSettingsRef.current();
      if (cancelled) return;

      const initialPosition = getInitialPlaybackPosition(video);
      const loaded = await loadVideo(video, initialPosition);

      if (cancelled || loaded) {
        return;
      }

      setPlayerViewState({ errorMode: 'load', isErrorDialogOpen: true });
    };

    void loadInitialVideo();

    return () => {
      cancelled = true;
    };
  }, [video?.id, video?.fileSrc, serverUrl, getInitialPlaybackPosition, loadVideo, video]);

  const attemptPlaybackRecovery = useCallback(async () => {
    if (!video) {
      return;
    }

    playbackRecoveryInFlightRef.current = true;
    setPlayerViewState({
      isRecoveringPlaybackError: true,
      isPlayerLoading: true,
      videoLoaded: false,
    });

    const recovered = await loadVideo(video, lastKnownPositionRef.current);

    playbackRecoveryInFlightRef.current = false;

    if (!recovered) {
      setPlayerViewState({
        errorMode: 'playback',
        isRecoveringPlaybackError: false,
        isPlaybackBuffering: false,
        isErrorDialogOpen: true,
      });
    }
  }, [loadVideo, video]);

  /** Returns true when mpv hit EOF before the real end and the situation was handled here. */
  const handlePrematureEof = useCallback(
    async (eofReached: boolean, duration: number | null | undefined) => {
      // The stream was cut before the end (connection lost, server down): this is not a finished video
      if (!eofReached || isGenuineEnd(lastPlayingPositionRef.current, duration)) {
        return false;
      }

      if (prematureEofRetriesRef.current >= MAX_PREMATURE_EOF_RETRIES) {
        setPlayerViewState({
          errorMode: 'playback',
          isPlaybackBuffering: false,
          isErrorDialogOpen: true,
        });
        return true;
      }

      prematureEofRetriesRef.current += 1;
      lastRecoveryPositionRef.current = lastKnownPositionRef.current;
      setPlayerViewState({ isPlaybackBuffering: false });
      await attemptPlaybackRecovery();
      return true;
    },
    [attemptPlaybackRecovery],
  );

  /** Remembers where playback really is (never the EOF jump of a failed seek) and re-arms the retries. */
  const trackPlaybackPosition = useCallback((position: number | null | undefined, eof: boolean) => {
    if (eof || typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
      return;
    }

    lastKnownPositionRef.current = position;
    lastPlayingPositionRef.current = position;

    // Real progress after the last recovery means the stream is healthy again
    if (position > lastRecoveryPositionRef.current + RECOVERY_PROGRESS_SECONDS) {
      prematureEofRetriesRef.current = 0;
    }
  }, []);

  const pollPlaybackHealth = useCallback(async () => {
    if (
      leavingRef.current ||
      healthCheckInFlightRef.current ||
      playbackRecoveryInFlightRef.current
    ) {
      return;
    }

    healthCheckInFlightRef.current = true;

    try {
      const playbackStatus = await mpv.getPlaybackStatus();
      trackPlaybackPosition(playbackStatus.position, playbackStatus.eofReached);

      if (await handlePrematureEof(playbackStatus.eofReached, playbackStatus.duration)) {
        return;
      }

      if (playbackStatus.idleActive && !playbackStatus.eofReached) {
        if (Date.now() - lastSeekedAtRef.current < 1500) {
          setPlayerViewState({ isPlaybackBuffering: true });
          return;
        }

        setPlayerViewState({ isPlaybackBuffering: false });
        await attemptPlaybackRecovery();
        return;
      }

      const buffering = playbackStatus.pausedForCache || playbackStatus.seeking;
      setPlayerViewState({ isPlaybackBuffering: buffering });
    } catch (error) {
      console.error('Playback health check failed:', error);
      setPlayerViewState({ isPlaybackBuffering: false });
      await attemptPlaybackRecovery();
    } finally {
      healthCheckInFlightRef.current = false;
    }
  }, [attemptPlaybackRecovery, handlePrematureEof, trackPlaybackPosition, mpv.getPlaybackStatus]);

  useEffect(() => {
    if (!videoLoaded || isErrorDialogOpen) {
      return;
    }

    const interval = window.setInterval(() => {
      void pollPlaybackHealth();
    }, PLAYER_HEALTH_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [videoLoaded, isErrorDialogOpen, pollPlaybackHealth]);

  useEffect(() => {
    if (!videoLoaded || !video || !currentUserId) {
      return;
    }

    const checkIfEnded = async () => {
      try {
        const playbackStatus = await mpv.getPlaybackStatus();

        if (
          !leavingRef.current &&
          playbackStatus.eofReached &&
          isGenuineEnd(lastPlayingPositionRef.current, playbackStatus.duration) &&
          !videoEndedTrackedRef.current
        ) {
          videoEndedTrackedRef.current = true;
          updateWatchState({
            videoId: video.id,
            timeWatched: lastKnownPositionRef.current,
            watched: true,
          });
          onPlaybackFinishedRef.current?.();
        }
      } catch (error) {
        console.error('Error checking if video ended:', error);
      }
    };

    const interval = window.setInterval(() => {
      void checkIfEnded();
    }, PLAYER_HEALTH_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [videoLoaded, video, currentUserId, updateWatchState, mpv.getPlaybackStatus]);

  useEffect(() => {
    return () => {
      const currentVideo = currentVideoRef.current;
      const activeUserId = currentUserIdRef.current;

      if (
        currentVideo &&
        activeUserId &&
        watchStateTrackedRef.current &&
        !videoEndedTrackedRef.current
      ) {
        updateWatchState({
          videoId: currentVideo.id,
          timeWatched: lastKnownPositionRef.current,
          watched: false,
        });
      }

      // Already stopped when another video took over (see openOtherVideo)
      if (!leavingRef.current) void mpv.stop();
    };
  }, [updateWatchState, mpv.stop]);

  const handleGoBack = useCallback(async () => {
    await mpv.stop();
    await mpv.embedMpv();
    navigate(-1);
  }, [navigate, mpv.stop, mpv.embedMpv]);

  /**
   * Plays another video (next episode) exactly as if the user left the player and opened it
   * again: same teardown as going back, then the page is mounted from scratch for the new video.
   * Loading a second file into the same mpv broke the video window glue on macOS.
   */
  const openOtherVideo = useCallback(
    async (videoId: string) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      setPlayerViewState({ videoLoaded: false, isPlayerLoading: true, isPlaybackBuffering: false });
      await mpv.stop();
      await mpv.embedMpv();
      navigate(`/video-player/${videoId}`, { replace: true });
    },
    [navigate, mpv.stop, mpv.embedMpv],
  );

  /** Marks the current video as watched (once), e.g. when skipping to the next episode. */
  const markCurrentAsWatched = useCallback(() => {
    if (!video || !currentUserId || videoEndedTrackedRef.current) return;
    videoEndedTrackedRef.current = true;
    updateWatchState({
      videoId: video.id,
      timeWatched: lastKnownPositionRef.current,
      watched: true,
    });
  }, [video, currentUserId, updateWatchState]);

  const handleRetry = useCallback(async () => {
    if (!video) {
      return;
    }

    setPlayerViewState({
      isErrorDialogOpen: false,
      videoLoaded: false,
      isPlayerLoading: true,
      isPlaybackBuffering: false,
    });

    // A failed load ends mpv's only file (idle=once): it ignores any later load. Start from a
    // new instance, as when entering the player.
    await mpv.stop();
    await mpv.embedMpv();
    await reapplyAppSettings();

    const retryPosition =
      errorMode === 'playback' ? lastKnownPositionRef.current : getInitialPlaybackPosition(video);
    const loaded = await loadVideo(video, retryPosition);

    if (!loaded) {
      setPlayerViewState({ isErrorDialogOpen: true });
      return;
    }

    setPlayerViewState({ isRecoveringPlaybackError: false });
  }, [
    errorMode,
    getInitialPlaybackPosition,
    loadVideo,
    video,
    mpv.stop,
    mpv.embedMpv,
    reapplyAppSettings,
  ]);

  useKeyboardBack({
    enabled: !videoLoaded && !isErrorDialogOpen,
    preAction: () => {
      void mpv.stop();
      void mpv.embedMpv();
    },
  });

  const shouldShowLoadingOverlay =
    !isErrorDialogOpen && (isPlayerLoading || isPlaybackBuffering || !videoLoaded);
  const shouldUseBlackLoadingBackdrop = !videoLoaded || showInitialLoadingBackdrop;

  const handleSeekCommitted = useCallback((position: number) => {
    if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
      return;
    }

    lastSeekedAtRef.current = Date.now();
    lastKnownPositionRef.current = position;
    lastPlayingPositionRef.current = position;
  }, []);

  return {
    isPageLoading: !video || loadingVideo,
    videoLoaded,
    isRecoveringPlaybackError,
    isErrorDialogOpen,
    errorMode,
    shouldShowLoadingOverlay,
    shouldUseBlackLoadingBackdrop,
    handleGoBack,
    handleRetry,
    handleSeekCommitted,
    markCurrentAsWatched,
    openOtherVideo,
  };
}

function VideoPlayerPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const fromStart = !!useLocation().state?.fromStart;
  const { serverUrl, currentUserId } = useServerStore((state) => ({
    serverUrl: state.selectedServer?.url ?? '',
    currentUserId: state.currentUser?.id,
  }));

  const reapplyAppSettings = useAppSettingsMpv();

  const {
    data: video,
    isLoading: loadingVideo,
    isError: videoFailedToLoad,
  } = useGetVideo<Video>(videoId ?? '', {
    enabled: !!videoId && serverUrl !== '',
  });
  const nextEpisode = useNextEpisode(video);
  const autoplayNext = useSettingsStore((state) => state.settings.autoplayNext);
  const markCurrentAsWatchedRef = useRef<() => void>(() => {});
  const openOtherVideoRef = useRef<(videoId: string) => Promise<void>>(async () => {});

  // The player replaces itself: going back still leads to where playback was started from
  const playNextEpisode = useCallback(() => {
    if (!nextEpisode) return;
    markCurrentAsWatchedRef.current();
    useSeriesDetailsFocusStore.getState().setPlayedEpisode({
      seriesId: nextEpisode.seriesId,
      seasonId: nextEpisode.episode.seasonId,
      episodeId: nextEpisode.episode.id,
    });
    void openOtherVideoRef.current(nextEpisode.episode.video.id);
  }, [nextEpisode]);

  const handlePlaybackFinished = useCallback(() => {
    if (autoplayNext) playNextEpisode();
  }, [autoplayNext, playNextEpisode]);

  const {
    isPageLoading,
    videoLoaded,
    isRecoveringPlaybackError,
    isErrorDialogOpen,
    errorMode,
    shouldShowLoadingOverlay,
    shouldUseBlackLoadingBackdrop,
    handleGoBack,
    handleRetry,
    handleSeekCommitted,
    markCurrentAsWatched,
    openOtherVideo,
  } = useVideoPlayerPageController({
    video,
    loadingVideo,
    serverUrl,
    currentUserId,
    navigate,
    fromStart,
    onPlaybackFinished: handlePlaybackFinished,
    reapplyAppSettings,
  });
  markCurrentAsWatchedRef.current = markCurrentAsWatched;
  openOtherVideoRef.current = openOtherVideo;

  const trackSelection = useTrackSelection(video, videoLoaded);

  if (!video && videoFailedToLoad) {
    // Unknown id, no access or server error: never leave the user on an endless spinner
    return (
      <AppAlertDialog
        open
        subtitle="Unable to start playback"
        title="Video not available"
        description="This video could not be found or you do not have access to it."
        primaryAction={{ label: 'Go back', onPress: () => navigate(-1) }}
      />
    );
  }

  if (isPageLoading) {
    return <Loading />;
  }

  if (!video) {
    return <Loading />;
  }

  return (
    <>
      {!!shouldShowLoadingOverlay && (
        <div
          className={`fixed inset-0 z-90 flex items-center justify-center ${shouldUseBlackLoadingBackdrop ? 'bg-black' : 'pointer-events-none bg-transparent'}`}
        >
          <Loading />
        </div>
      )}

      <AppAlertDialog
        open={isErrorDialogOpen}
        subtitle={errorMode === 'playback' ? 'Playback interrupted' : 'Unable to start playback'}
        title="Video could not be loaded"
        description={
          errorMode === 'playback'
            ? 'Playback failed while the video was running. We tried to recover your session and could not continue streaming.'
            : 'We could not load this video in time. Please check your connection or try again.'
        }
        secondaryAction={{
          label: 'Go back',
          onPress: handleGoBack,
        }}
        primaryAction={{
          label: 'Retry',
          onPress: handleRetry,
        }}
      />

      {!!videoLoaded && !isRecoveringPlaybackError && (
        <VideoPlayer
          key={video.id}
          video={video}
          trackSelection={trackSelection}
          onSeekCommitted={handleSeekCommitted}
          nextEpisode={nextEpisode?.episode}
          onPlayNext={playNextEpisode}
        />
      )}
    </>
  );
}

/** A new video is a new page: its player state starts from scratch, as when opened from the app. */
function VideoPlayerRoute() {
  const { videoId } = useParams();
  return <VideoPlayerPage key={videoId} />;
}

export default memo(VideoPlayerRoute);
