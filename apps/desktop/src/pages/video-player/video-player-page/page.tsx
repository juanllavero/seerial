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
import { VideoPlayer } from '@/features/video-player';
import { useMpvPlayer } from '@/features/video-player/hooks/use-mpv-player';
import { useTrackSelection } from '@/features/video-player/hooks/use-track-selection';
import { resolveResumePosition } from '@/features/video-player/utils/resume-position';
import AppAlertDialog from '@/shared/components/app-alert-dialog';
import {
  resetAppShellBackground,
  setAppShellBackground,
} from '@/shared/components/details/details-background-mpv';
import Loading from '@/shared/components/loading';
import { useKeyboardBack } from '@/shared/hooks/use-keyboard-back';
import { isGenuineEnd } from '@/shared/utils/playback-end';
import { useAppSettingsMpv } from '../../../features/video-player/hooks/use-app-settings-mpv';

const LOAD_TIMEOUT_MS = 15000;
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
}: {
  video?: Video;
  loadingVideo: boolean;
  serverUrl: string;
  currentUserId?: string;
  navigate: ReturnType<typeof useNavigate>;
  /** Ignore the saved progress. */
  fromStart: boolean;
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
          await mpv.setPosition(resumeAt);
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
    [getSignedStreamUrl, mpv.loadUrl, mpv.waitForReady, mpv.setPosition, mpv.play],
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
      watchStateTrackedRef.current = false;
      videoEndedTrackedRef.current = false;
      setPlayerViewState({ videoLoaded: false });

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
    if (healthCheckInFlightRef.current || playbackRecoveryInFlightRef.current) {
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

      void mpv.stop();
    };
  }, [updateWatchState, mpv.stop]);

  const handleGoBack = useCallback(async () => {
    await mpv.stop();
    await mpv.embedMpv();
    navigate(-1);
  }, [navigate, mpv.stop, mpv.embedMpv]);

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

    const retryPosition =
      errorMode === 'playback' ? lastKnownPositionRef.current : getInitialPlaybackPosition(video);
    const loaded = await loadVideo(video, retryPosition);

    if (!loaded) {
      setPlayerViewState({ isErrorDialogOpen: true });
      return;
    }

    setPlayerViewState({ isRecoveringPlaybackError: false });
  }, [errorMode, getInitialPlaybackPosition, loadVideo, video]);

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

  useAppSettingsMpv();

  const {
    data: video,
    isLoading: loadingVideo,
    isError: videoFailedToLoad,
  } = useGetVideo<Video>(videoId ?? '', {
    enabled: !!videoId && serverUrl !== '',
  });
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
  } = useVideoPlayerPageController({
    video,
    loadingVideo,
    serverUrl,
    currentUserId,
    navigate,
    fromStart,
  });

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
          video={video}
          trackSelection={trackSelection}
          onSeekCommitted={handleSeekCommitted}
        />
      )}
    </>
  );
}

export default memo(VideoPlayerPage);
