import { getSignedSongStreamUrl } from '@seerial/api';
import { getSongPlaybackFilePath } from '@seerial/domain';
import { useMusicStore, useServerStore } from '@seerial/stores';
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';

const READY_POLL_INTERVAL_MS = 250;
const LOAD_TIMEOUT_MS = 5000;
const KARAOKE_MIX_MIN = -10;
const KARAOKE_MIX_MAX = 10;

type PlaybackBackend = 'mpv' | 'karaoke';

interface PlaybackStatus {
  position?: number;
  duration?: number;
  eofReached: boolean;
}

interface KaraokeStatus extends PlaybackStatus {
  paused?: boolean;
}

interface KaraokePreloadStatus {
  matchesRequest: boolean;
  isLoading: boolean;
  isReady: boolean;
  error?: string | null;
}

interface KaraokeStemUrls {
  instrumental: string;
  vocals: string;
}

interface PlaybackResumeState {
  position: number;
  shouldPlay: boolean;
}

interface UseMusicPlayerMpvOptions {
  onKaraokeUnavailable?: () => void;
}

export interface UseMusicPlayerMpvResult {
  isKaraokeActive: boolean;
  isKaraokeAvailable: boolean;
  isKaraokePreparing: boolean;
  isKaraokeReady: boolean;
  shouldShowKaraokeButton: boolean;
  karaokeMix: number;
  isAtmosActive: boolean;
  isAtmosAvailable: boolean;
  togglePlayPause: () => Promise<void>;
  stopPlayback: () => void;
  handleKaraokeMixChange: (value: number) => Promise<void>;
  toggleAtmos: () => Promise<void>;
  getActivePlaybackPosition: () => Promise<number>;
  getActivePlaybackDuration: () => Promise<number>;
  setActivePlaybackPosition: (position: number) => Promise<void>;
}

function clampKaraokeMix(value: number): number {
  return Math.min(Math.max(value, KARAOKE_MIX_MIN), KARAOKE_MIX_MAX);
}

function getKaraokeMixVolumes(mixValue: number): { instrumental: number; vocals: number } {
  const clampedValue = clampKaraokeMix(mixValue);

  if (clampedValue < 0) {
    return { instrumental: 1, vocals: (10 + clampedValue) / 10 };
  }

  if (clampedValue > 0) {
    return { instrumental: (10 - clampedValue) / 10, vocals: 1 };
  }

  return { instrumental: 1, vocals: 1 };
}

async function waitForAudioReady(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  const pollUntilReady = async (): Promise<boolean> => {
    if (Date.now() - startedAt >= timeoutMs) {
      return false;
    }

    try {
      const duration = await invoke<number>('get_duration');
      if (Number.isFinite(duration) && duration > 0) {
        return true;
      }
    } catch {
      // Keep polling until timeout to allow MPV metadata parsing.
    }

    await new Promise<void>((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    return pollUntilReady();
  };

  return pollUntilReady();
}

function useKaraokeAvailability(
  instrumentalFileSrc: string | null | undefined,
  vocalsFileSrc: string | null | undefined,
  serverUrl: string,
  isShown: boolean,
  onUnavailable?: () => void,
) {
  const karaokeAvailabilityAttemptRef = useRef(0);
  const karaokePreloadAttemptRef = useRef(0);
  const [karaokeStemUrls, setKaraokeStemUrls] = useState<KaraokeStemUrls | null>(null);
  const [isKaraokePreparing, setIsKaraokePreparing] = useState(false);
  const [isKaraokeReady, setIsKaraokeReady] = useState(false);

  const markUnavailable = useCallback(
    (error?: unknown) => {
      if (error) {
        console.error('Failed to preload karaoke stems:', error);
      }

      setIsKaraokePreparing(false);
      setIsKaraokeReady(false);
      setKaraokeStemUrls(null);
      void invoke('reset_karaoke_preload').catch(() => undefined);
      onUnavailable?.();
    },
    [onUnavailable],
  );

  const resolveKaraokeStems = useCallback(() => {
    if (!instrumentalFileSrc || !vocalsFileSrc || !serverUrl || !isShown) {
      setKaraokeStemUrls(null);
      setIsKaraokePreparing(false);
      setIsKaraokeReady(false);
      return;
    }

    const currentAttempt = ++karaokeAvailabilityAttemptRef.current;

    void Promise.allSettled([
      getSignedSongStreamUrl({ filePath: instrumentalFileSrc, expiresIn: '10m', isDesktop: true }),
      getSignedSongStreamUrl({ filePath: vocalsFileSrc, expiresIn: '10m', isDesktop: true }),
    ])
      .then(([instrumentalResult, vocalsResult]) => {
        if (currentAttempt !== karaokeAvailabilityAttemptRef.current) {
          return;
        }

        if (
          instrumentalResult.status !== 'fulfilled' ||
          vocalsResult.status !== 'fulfilled' ||
          !instrumentalResult.value ||
          !vocalsResult.value
        ) {
          setKaraokeStemUrls(null);
          setIsKaraokePreparing(false);
          setIsKaraokeReady(false);
          onUnavailable?.();
          return;
        }

        setKaraokeStemUrls({
          instrumental: `${serverUrl}${instrumentalResult.value}`,
          vocals: `${serverUrl}${vocalsResult.value}`,
        });
        setIsKaraokePreparing(true);
        setIsKaraokeReady(false);
      })
      .catch(() => {
        if (currentAttempt !== karaokeAvailabilityAttemptRef.current) {
          return;
        }

        setKaraokeStemUrls(null);
        setIsKaraokePreparing(false);
        setIsKaraokeReady(false);
        onUnavailable?.();
      });
  }, [instrumentalFileSrc, isShown, onUnavailable, serverUrl, vocalsFileSrc]);

  const handlePolledPreloadStatus = useCallback(
    (status: KaraokePreloadStatus): boolean => {
      if (!status.matchesRequest || status.isLoading) {
        return false;
      }

      if (status.isReady) {
        setIsKaraokePreparing(false);
        setIsKaraokeReady(true);
        return true;
      }

      markUnavailable(status.error ?? 'Unknown error');
      return true;
    },
    [markUnavailable],
  );

  const clearPollingInterval = useCallback((pollIntervalId: number | null) => {
    if (pollIntervalId !== null) {
      window.clearInterval(pollIntervalId);
    }
  }, []);

  const isStalePreloadAttempt = useCallback(
    (attempt: number) => attempt !== karaokePreloadAttemptRef.current,
    [],
  );

  const pollKaraokePreloadStatus = useCallback(
    (attempt: number, pollIntervalId: number | null, stemUrls: KaraokeStemUrls) => {
      void invoke<KaraokePreloadStatus>('get_karaoke_preload_status_for_urls', {
        instUrl: stemUrls.instrumental,
        voiceUrl: stemUrls.vocals,
      })
        .then((status) => {
          if (isStalePreloadAttempt(attempt)) {
            clearPollingInterval(pollIntervalId);
            return;
          }

          if (handlePolledPreloadStatus(status)) {
            clearPollingInterval(pollIntervalId);
          }
        })
        .catch((error) => {
          if (isStalePreloadAttempt(attempt)) {
            clearPollingInterval(pollIntervalId);
            return;
          }

          clearPollingInterval(pollIntervalId);
          markUnavailable(error);
        });
    },
    [clearPollingInterval, handlePolledPreloadStatus, isStalePreloadAttempt, markUnavailable],
  );

  useEffect(() => {
    void resolveKaraokeStems();
  }, [resolveKaraokeStems]);

  useEffect(() => {
    if (!karaokeStemUrls) {
      return;
    }

    const currentAttempt = ++karaokePreloadAttemptRef.current;
    let pollIntervalId: number | null = null;
    setIsKaraokePreparing(true);
    setIsKaraokeReady(false);

    void invoke('preload_karaoke', {
      instUrl: karaokeStemUrls.instrumental,
      voiceUrl: karaokeStemUrls.vocals,
    })
      .then(() => {
        pollIntervalId = window.setInterval(() => {
          pollKaraokePreloadStatus(currentAttempt, pollIntervalId, karaokeStemUrls);
        }, 250);
      })
      .catch((error) => {
        if (isStalePreloadAttempt(currentAttempt)) {
          return;
        }

        markUnavailable(error);
      });

    return () => {
      clearPollingInterval(pollIntervalId);
    };
  }, [
    clearPollingInterval,
    isStalePreloadAttempt,
    karaokeStemUrls,
    markUnavailable,
    pollKaraokePreloadStatus,
  ]);

  const resetKaraokeAvailability = useCallback(() => {
    setKaraokeStemUrls(null);
    setIsKaraokePreparing(false);
    setIsKaraokeReady(false);
    void invoke('reset_karaoke_preload').catch(() => undefined);
  }, []);

  return {
    karaokeStemUrls,
    isKaraokePreparing,
    isKaraokeReady,
    shouldShowKaraokeButton: isKaraokePreparing || isKaraokeReady,
    resetKaraokeAvailability,
  };
}

/**
 * Encapsulates all MPV and karaoke native player calls for the music player.
 * Components should use this hook instead of calling invoke() directly.
 */
export function useMusicPlayerMpv({
  onKaraokeUnavailable,
}: UseMusicPlayerMpvOptions = {}): UseMusicPlayerMpvResult {
  const serverUrl = useServerStore((state) => state.selectedServer?.url ?? '');
  const {
    currentSong,
    isPlaying,
    duration,
    isShown,
    playbackVersion,
    isAtmosEnabled,
    setIsPlaying,
    setIsLoading,
    setCurrentTime,
    setDuration,
    setProgress,
    setIsAtmosEnabled,
    resetPlayerState,
    handleNext,
  } = useMusicStore(
    (state) => ({
      currentSong: state.currentSong,
      isPlaying: state.isPlaying,
      duration: state.duration,
      isShown: state.isShown,
      playbackVersion: state.playbackVersion,
      isAtmosEnabled: state.isAtmosEnabled,
      setIsPlaying: state.setIsPlaying,
      setIsLoading: state.setIsLoading,
      setCurrentTime: state.setCurrentTime,
      setDuration: state.setDuration,
      setProgress: state.setProgress,
      setIsAtmosEnabled: state.setIsAtmosEnabled,
      resetPlayerState: state.resetPlayerState,
      handleNext: state.handleNext,
    }),
    shallow,
  );

  const loadAttemptRef = useRef(0);
  const eofGuardRef = useRef(false);
  const pendingResumeRef = useRef<PlaybackResumeState | null>(null);
  const [playbackBackend, setPlaybackBackend] = useState<PlaybackBackend>('mpv');
  const [karaokeMix, setKaraokeMix] = useState(0);

  const {
    karaokeStemUrls,
    isKaraokePreparing,
    isKaraokeReady,
    shouldShowKaraokeButton,
    resetKaraokeAvailability,
  } = useKaraokeAvailability(
    currentSong?.instrumentalFileSrc,
    currentSong?.vocalsFileSrc,
    serverUrl,
    isShown,
    onKaraokeUnavailable,
  );

  const getActivePlaybackStatus = useCallback(async (): Promise<PlaybackStatus> => {
    if (playbackBackend === 'karaoke') {
      const status = await invoke<KaraokeStatus>('get_karaoke_status');
      return {
        position: status.position,
        duration: status.duration,
        eofReached: status.eofReached,
      };
    }

    return invoke<PlaybackStatus>('get_playback_status');
  }, [playbackBackend]);

  const getActivePlaybackPosition = useCallback(async (): Promise<number> => {
    if (playbackBackend === 'karaoke') {
      const status = await invoke<KaraokeStatus>('get_karaoke_status');
      return status.position ?? 0;
    }

    return invoke<number>('get_position');
  }, [playbackBackend]);

  const getActivePlaybackDuration = useCallback(async (): Promise<number> => {
    if (playbackBackend === 'karaoke') {
      const status = await invoke<KaraokeStatus>('get_karaoke_status');
      return status.duration ?? duration ?? 0;
    }

    return invoke<number>('get_duration');
  }, [duration, playbackBackend]);

  const setActivePlaybackPosition = useCallback(
    async (position: number): Promise<void> => {
      if (playbackBackend === 'karaoke') {
        await invoke('seek_karaoke', { position });
        return;
      }

      await invoke('set_position', { position });
    },
    [playbackBackend],
  );

  const updatePlaybackProgress = useCallback(
    (statusPosition: number) => {
      setCurrentTime(statusPosition);
      const safeDuration = duration > 0 ? duration : (currentSong?.duration ?? 0);

      if (safeDuration > 0) {
        setProgress((statusPosition / safeDuration) * 100);
      }
    },
    [currentSong?.duration, duration, setCurrentTime, setProgress],
  );

  const processPlaybackStatus = useCallback(
    (status: PlaybackStatus) => {
      if (typeof status.position === 'number' && Number.isFinite(status.position)) {
        updatePlaybackProgress(status.position);
      }

      if (typeof status.duration === 'number' && Number.isFinite(status.duration)) {
        setDuration(status.duration);
      }

      if (!status.eofReached || eofGuardRef.current) {
        return;
      }

      eofGuardRef.current = true;
      handleNext();
      window.setTimeout(() => {
        eofGuardRef.current = false;
      }, 200);
    },
    [handleNext, setDuration, updatePlaybackProgress],
  );

  const loadMpvSource = useCallback(
    async (
      filePath: string,
      attempt: number,
      resume?: PlaybackResumeState,
    ): Promise<boolean> => {
      const signedUrl = await getSignedSongStreamUrl({
        filePath,
        expiresIn: '10m',
        isDesktop: true,
      });

      if (!signedUrl || attempt !== loadAttemptRef.current) {
        return false;
      }

      if (resume && !resume.shouldPlay) {
        await invoke('pause');
      }

      await invoke('load_url', { url: `${serverUrl}${signedUrl}` });

      const ready = await waitForAudioReady(LOAD_TIMEOUT_MS);
      if (!ready || attempt !== loadAttemptRef.current) {
        return false;
      }

      if (resume) {
        await invoke('set_position', { position: resume.position });
        setCurrentTime(resume.position);
      }

      if (resume && !resume.shouldPlay) {
        setIsPlaying(false);
        return true;
      }

      await invoke('play');
      setIsPlaying(true);
      return true;
    },
    [serverUrl, setCurrentTime, setIsPlaying],
  );

  const loadCurrentSong = useCallback(async () => {
    if (!currentSong || !serverUrl || !isShown || playbackBackend !== 'mpv') {
      return;
    }

    const currentAttempt = ++loadAttemptRef.current;
    const resume = pendingResumeRef.current ?? undefined;
    pendingResumeRef.current = null;
    // Read the preference from the store so toggling it never reloads the song on its own.
    const filePath = getSongPlaybackFilePath(currentSong, useMusicStore.getState().isAtmosEnabled);
    setIsLoading(true);

    try {
      await loadMpvSource(filePath, currentAttempt, resume);
    } catch (error) {
      console.error(error);
      setIsPlaying(false);
    } finally {
      if (currentAttempt === loadAttemptRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentSong, isShown, loadMpvSource, playbackBackend, serverUrl, setIsLoading, setIsPlaying]);

  const activateKaraokePlayback = useCallback(
    async (nextMix: number) => {
      if (!karaokeStemUrls) {
        return;
      }

      const nextPosition = await getActivePlaybackPosition();
      const shouldStartPaused = !isPlaying;
      const { instrumental, vocals } = getKaraokeMixVolumes(nextMix);

      setIsLoading(true);

      try {
        if (playbackBackend !== 'karaoke') {
          await invoke('stop');
          await invoke('start_karaoke', {
            instUrl: karaokeStemUrls.instrumental,
            voiceUrl: karaokeStemUrls.vocals,
            position: nextPosition,
            paused: shouldStartPaused,
          });
          setPlaybackBackend('karaoke');
        }

        await invoke('set_karaoke_mix', { instVol: instrumental, voiceVol: vocals });
      } catch (error) {
        console.error(error);
        setPlaybackBackend('mpv');
        setIsPlaying(false);
        setKaraokeMix(0);
        await invoke('stop_karaoke').catch(() => undefined);
      } finally {
        setIsLoading(false);
      }
    },
    [
      getActivePlaybackPosition,
      isPlaying,
      karaokeStemUrls,
      playbackBackend,
      setIsLoading,
      setIsPlaying,
    ],
  );

  const handleKaraokeMixChange = useCallback(
    async (value: number) => {
      const nextMix = clampKaraokeMix(value);
      setKaraokeMix(nextMix);

      if (nextMix === 0 && playbackBackend !== 'karaoke') {
        return;
      }

      await activateKaraokePlayback(nextMix);
    },
    [activateKaraokePlayback, playbackBackend],
  );

  const toggleAtmos = useCallback(async () => {
    if (!currentSong?.atmosFileSrc || !serverUrl || !isShown) {
      return;
    }

    const isKaraokePlayback = playbackBackend === 'karaoke';
    const nextEnabled = isKaraokePlayback || !isAtmosEnabled;
    const currentAttempt = ++loadAttemptRef.current;
    setIsLoading(true);

    try {
      const resume: PlaybackResumeState = {
        position: await getActivePlaybackPosition(),
        shouldPlay: isPlaying,
      };
      setIsAtmosEnabled(nextEnabled);

      if (isKaraokePlayback) {
        // Returning to the mpv backend reloads the song through loadCurrentSong, which resumes from here.
        await invoke('stop_karaoke').catch(() => undefined);
        pendingResumeRef.current = resume;
        setKaraokeMix(0);
        setPlaybackBackend('mpv');
        return;
      }

      const loaded = await loadMpvSource(
        getSongPlaybackFilePath(currentSong, nextEnabled),
        currentAttempt,
        resume,
      ).catch((error) => {
        console.error(error);
        return false;
      });

      if (loaded || currentAttempt !== loadAttemptRef.current) {
        return;
      }

      // The new source failed to load: restore the previous one at the same position.
      setIsAtmosEnabled(!nextEnabled);
      await loadMpvSource(getSongPlaybackFilePath(currentSong, !nextEnabled), currentAttempt, resume);
    } catch (error) {
      console.error(error);
    } finally {
      if (currentAttempt === loadAttemptRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    currentSong,
    getActivePlaybackPosition,
    isAtmosEnabled,
    isPlaying,
    isShown,
    loadMpvSource,
    playbackBackend,
    serverUrl,
    setIsAtmosEnabled,
    setIsLoading,
  ]);

  const togglePlayPause = useCallback(async () => {
    try {
      if (isPlaying) {
        if (playbackBackend === 'karaoke') {
          await invoke('pause_karaoke');
        } else {
          await invoke('pause');
        }
        setIsPlaying(false);
      } else {
        if (playbackBackend === 'karaoke') {
          await invoke('resume_karaoke');
        } else {
          await invoke('play');
        }
        setIsPlaying(true);
      }
    } catch (error) {
      console.error(error);
    }
  }, [isPlaying, playbackBackend, setIsPlaying]);

  const stopPlayback = useCallback(() => {
    invoke('stop').catch(console.error);
    invoke('stop_karaoke').catch(console.error);
    setPlaybackBackend('mpv');
    setKaraokeMix(0);
    resetKaraokeAvailability();
    resetPlayerState();
  }, [resetKaraokeAvailability, resetPlayerState]);

  // Embed MPV on mount
  useEffect(() => {
    invoke('embed_mpv').catch(console.error);
  }, []);

  // Cleanup karaoke on unmount
  useEffect(() => {
    return () => {
      void invoke('stop_karaoke').catch(() => undefined);
    };
  }, []);

  // Reset karaoke state when the current song changes
  useEffect(() => {
    if (!currentSong?.id) {
      resetKaraokeAvailability();
    }

    setPlaybackBackend('mpv');
    setKaraokeMix(0);
    pendingResumeRef.current = null;
    resetKaraokeAvailability();
    void invoke('stop_karaoke').catch(() => undefined);
  }, [currentSong?.id, resetKaraokeAvailability]);

  // Load the current song whenever it changes, or when the same song is re-selected.
  // playbackVersion acts as a monotonic reload trigger so the effect re-fires even when
  // currentSong is the same object reference (e.g. single-song REPEAT_ALL queue wraps around).
  // biome-ignore lint/correctness/useExhaustiveDependencies: playbackVersion is an intentional reload trigger, not a value consumed inside the callback
  useEffect(() => {
    void loadCurrentSong();
  }, [loadCurrentSong, playbackVersion]);

  // Poll playback status while a song is active
  useEffect(() => {
    if (!currentSong || !isShown) {
      return;
    }

    const interval = window.setInterval(() => {
      void getActivePlaybackStatus()
        .then(processPlaybackStatus)
        .catch((error) => {
          console.error('Music playback health check failed:', error);
        });
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentSong, getActivePlaybackStatus, isShown, processPlaybackStatus]);

  return {
    isKaraokeActive: playbackBackend === 'karaoke',
    isKaraokeAvailable: Boolean(karaokeStemUrls),
    isKaraokePreparing,
    isKaraokeReady,
    shouldShowKaraokeButton,
    karaokeMix,
    isAtmosActive:
      isAtmosEnabled && !!currentSong?.atmosFileSrc && playbackBackend === 'mpv',
    isAtmosAvailable: !!currentSong?.atmosFileSrc,
    togglePlayPause,
    stopPlayback,
    handleKaraokeMixChange,
    toggleAtmos,
    getActivePlaybackPosition,
    getActivePlaybackDuration,
    setActivePlaybackPosition,
  };
}
