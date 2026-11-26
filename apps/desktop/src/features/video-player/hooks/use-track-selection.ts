import { useGetVideoPlaybackInfo, useSetVideoTrackSelection } from '@seerial/api';
import type { AudioTrack, PlayBackInfo, SubtitleTrack, Video } from '@seerial/domain';
import {
  findPreferredSubtitleIndex,
  getAudioTrack,
  getSubtitleTrack,
  SUBTITLES_OFF,
} from '@seerial/domain';
import { useServerStore } from '@seerial/stores';
import { useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMpvPlayer } from './use-mpv-player';

interface Selection {
  videoId: string;
  audio: AudioTrack | null;
  subtitle: SubtitleTrack | null;
}

/** Title written in the file for each track, by ffprobe stream index (same ids as the server). */
export type TrackTitles = Record<number, string>;

export interface TrackSelection {
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  selectedAudio: AudioTrack | null;
  selectedSubtitle: SubtitleTrack | null;
  titles: TrackTitles;
  chooseAudio: (track: AudioTrack) => Promise<void>;
  chooseSubtitle: (track: SubtitleTrack | null) => Promise<void>;
}

/**
 * Owns the audio and subtitle choice of the video being played.
 * It must live in the player page: the controls (and their menus) are unmounted every time they
 * hide, so a choice kept there would be lost and replaced by the default one.
 */
export function useTrackSelection(video: Video | undefined, videoLoaded: boolean): TrackSelection {
  const { i18n } = useTranslation();
  const mpv = useMpvPlayer();
  const serverUrl = useServerStore((state) => state.selectedServer?.url ?? '');
  const { data: playBackInfo } = useGetVideoPlaybackInfo<PlayBackInfo>(video?.id ?? '', {
    enabled: !!video?.id && serverUrl !== '',
  });
  // The track choice belongs to the user: it never changes what other users get
  const { mutate: saveSelection } = useSetVideoTrackSelection<
    void,
    { selectedAudioTrack?: number; selectedSubtitleTrack?: number }
  >(video?.id ?? '');

  const [selection, setSelection] = useState<Selection | null>(null);
  const [titles, setTitles] = useState<TrackTitles>({});
  const selectionRef = useRef<Selection | null>(null);
  const hasSavedRef = useRef(false);
  const queryClient = useQueryClient();
  const current = selection && selection.videoId === video?.id ? selection : null;
  const isReady = current !== null;
  const playbackConfig = playBackInfo?.playBackConfig;

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // The cached videos still hold the previous choice, and the next playback would start from it.
  // Dropped on leaving the player: refetching while playing would reload the video.
  useEffect(
    () => () => {
      if (hasSavedRef.current) queryClient.removeQueries({ queryKey: ['videos', 'get'] });
    },
    [queryClient],
  );

  // Default tracks, decided once per video: a later refresh of the data never changes them
  useEffect(() => {
    if (!video || !playbackConfig || selectionRef.current?.videoId === video.id) return;

    const subtitle = getSubtitleTrack(
      playbackConfig.preferSubLan,
      playbackConfig.subsMode,
      video,
      i18n.language,
      playbackConfig.preferAudioLan,
    );
    const initial: Selection = {
      videoId: video.id,
      audio: getAudioTrack(playbackConfig.preferAudioLan, video),
      subtitle: typeof subtitle === 'string' ? null : subtitle,
    };
    selectionRef.current = initial;
    setSelection(initial);
  }, [video, playbackConfig, i18n.language]);

  // mpv picks its own tracks every time it opens the file (first load and recoveries)
  useEffect(() => {
    const chosen = selectionRef.current;
    if (!videoLoaded || !isReady || !chosen) return;

    void (async () => {
      try {
        if (chosen.audio) await mpv.setAudioTrack(chosen.audio.id);
        await mpv.setSubtitleTrack(chosen.subtitle?.id ?? 0);
        setTitles(await invoke<TrackTitles>('get_track_titles'));
      } catch (error) {
        console.error('Could not apply the selected tracks', error);
      }
    })();
  }, [videoLoaded, isReady, mpv.setAudioTrack, mpv.setSubtitleTrack]);

  const chooseAudio = useCallback(
    async (track: AudioTrack) => {
      if (!video) return;

      // The subtitles depend on the audio (e.g. "only with foreign audio"): choose them again
      // for the new track, with the same rules as when the video is scanned
      const subtitleIndex = playbackConfig
        ? findPreferredSubtitleIndex(video.subtitleTracks, track, playbackConfig, i18n.language)
        : undefined;
      const subtitle =
        subtitleIndex !== undefined && subtitleIndex !== SUBTITLES_OFF
          ? (video.subtitleTracks?.[subtitleIndex] ?? null)
          : null;

      setSelection((previous) => ({
        videoId: video.id,
        audio: track,
        subtitle: subtitleIndex === undefined ? (previous?.subtitle ?? null) : subtitle,
      }));
      await mpv.setAudioTrack(track.id);
      if (subtitleIndex !== undefined) await mpv.setSubtitleTrack(subtitle?.id ?? 0);

      const audioIndex = (video.audioTracks ?? []).findIndex((t) => t.id === track.id);
      if (audioIndex !== -1) {
        // The server applies the same choice to the other episodes of the series
        hasSavedRef.current = true;
        saveSelection({
          selectedAudioTrack: audioIndex,
          ...(subtitleIndex !== undefined && { selectedSubtitleTrack: subtitleIndex }),
        });
      }
    },
    [video, playbackConfig, i18n.language, mpv.setAudioTrack, mpv.setSubtitleTrack, saveSelection],
  );

  const chooseSubtitle = useCallback(
    async (track: SubtitleTrack | null) => {
      if (!video) return;

      setSelection((previous) => ({
        videoId: video.id,
        audio: previous?.audio ?? null,
        subtitle: track,
      }));
      await mpv.setSubtitleTrack(track?.id ?? 0);

      const index = track
        ? (video.subtitleTracks ?? []).findIndex((t) => t.id === track.id)
        : SUBTITLES_OFF;
      if (!track || index !== -1) {
        hasSavedRef.current = true;
        saveSelection({ selectedSubtitleTrack: index });
      }
    },
    [video, mpv.setSubtitleTrack, saveSelection],
  );

  const mediaInfo = playBackInfo?.mediaInfoData;

  return {
    audioTracks: mediaInfo?.audioTracks ?? video?.audioTracks ?? [],
    subtitleTracks: mediaInfo?.subtitleTracks ?? video?.subtitleTracks ?? [],
    selectedAudio: current?.audio ?? null,
    selectedSubtitle: current?.subtitle ?? null,
    titles,
    chooseAudio,
    chooseSubtitle,
  };
}
