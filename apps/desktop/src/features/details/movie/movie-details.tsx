import {
  API,
  apiClient,
  unwrapApiPayload,
  useGetLibrary,
  useSetMovieWatchState,
  useUpdateVideoMediaInfo,
} from '@seerial/api';
import {
  type DetailsData,
  formatTimeForView,
  getAudioTrack,
  getMediaFormatBadges,
  getSubtitleTrack,
  type LibraryType,
  type Movie,
  needsMediaFormatAnalysis,
  type Video,
} from '@seerial/domain';
import { useServerStore } from '@seerial/stores';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { shallow } from 'zustand/shallow';
import DetailsBackgroundLayers from '@/shared/components/details/details-background-layers';
import DetailsBackgroundPlayback from '@/shared/components/details/details-background-playback';
import DetailsInfo from '@/shared/components/details/details-info';
import DetailsOptionsMenu from '@/shared/components/details/details-options-menu';
import Page from '@/shared/components/page';
import { formatAudioSummary, formatSubtitleSummary } from '@/shared/utils/track-labels';
import { getWatchProgress } from '@/shared/utils/watch-progress';
import DetailsWithRelatedContent from '../shared/details-with-related-content';

interface MovieDetailsProps {
  movie: Movie | undefined;
  isLoading: boolean;
  details: DetailsData | undefined;
  collectionId?: string;
  libraryType?: LibraryType;
}

function MovieDetails({ movie, isLoading, details, collectionId, libraryType }: MovieDetailsProps) {
  const { t, i18n } = useTranslation();
  const [selectedVideo, selectVideo] = useState<Video | null>(null);
  const [resolvedVideoData, setResolvedVideoData] = useState<Map<string, Video>>(new Map());
  const [isBackgroundVideoVisible, setIsBackgroundVideoVisible] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const backgroundImageSrc = details?.backgroundSrc ?? movie?.backgroundSrc ?? movie?.coverSrc;
  const queryClient = useQueryClient();
  const { currentUser } = useServerStore(
    (state) => ({
      currentUser: state.currentUser,
    }),
    shallow,
  );
  const navigate = useNavigate();
  const { mutateAsync: setMovieWatchState, isPending: isUpdatingWatchState } =
    useSetMovieWatchState<unknown, { watched: boolean }>(movie?.id ?? '');
  const { mutateAsync: updateMediaInfo } = useUpdateVideoMediaInfo(selectedVideo?.id ?? '');

  const { data: library } = useGetLibrary(movie?.libraryId ?? '', {
    enabled: !!movie?.libraryId,
  });

  useEffect(() => {
    if (movie && movie.videos.length > 0) {
      selectVideo(movie.videos[0]);
    }
  }, [movie]);

  const handlePlay = useCallback(() => {
    if (selectedVideo) {
      navigate(`/video-player/${selectedVideo.id}`);
    }
  }, [navigate, selectedVideo]);

  const handlePlayFromStart = useCallback(() => {
    if (selectedVideo) {
      navigate(`/video-player/${selectedVideo.id}`, { state: { fromStart: true } });
    }
  }, [navigate, selectedVideo]);

  const isWatched = useMemo(() => {
    return (
      movie?.watchLists?.some(
        (watchList) => watchList.userId === currentUser?.id && watchList.watched,
      ) ?? false
    );
  }, [movie, currentUser]);

  const handleMarkWatched = useCallback(async () => {
    if (!movie || isUpdatingWatchState) {
      return;
    }

    await setMovieWatchState({ watched: !isWatched });
    await queryClient.invalidateQueries({
      queryKey: ['movies', 'get', movie.id],
    });
  }, [movie, isUpdatingWatchState, isWatched, queryClient, setMovieWatchState]);

  useEffect(() => {
    // Analyse the video when it has no tracks yet, or when it was analysed before Dolby Atmos
    // detection existed (its tracks carry no Atmos information)
    const hasTracks = !!selectedVideo?.audioTracks && selectedVideo.audioTracks.length > 0;
    if (
      !selectedVideo?.id ||
      (hasTracks && !needsMediaFormatAnalysis(selectedVideo.audioTracks, selectedVideo.videoTracks))
    )
      return;
    if (resolvedVideoData.has(selectedVideo.id)) return;

    const videoId = selectedVideo.id;
    updateMediaInfo()
      .then(() => apiClient.get(API.videos.get(videoId)))
      .then((response) => {
        const updatedVideo = unwrapApiPayload<Video>(response.data);
        setResolvedVideoData((prev) => new Map(prev).set(videoId, updatedVideo));
      })
      .catch(() => {});
  }, [selectedVideo, resolvedVideoData, updateMediaInfo]);

  const effectiveVideo = useMemo(
    () => (selectedVideo ? (resolvedVideoData.get(selectedVideo.id) ?? selectedVideo) : null),
    [selectedVideo, resolvedVideoData],
  );

  // Audio track that will play for this user (their own pick or the library preference)
  const selectedAudioTrack = useMemo(() => {
    if (!effectiveVideo || !library) return undefined;
    return getAudioTrack(library.preferAudioLan ?? '', effectiveVideo) ?? undefined;
  }, [effectiveVideo, library]);

  const movieAudioInfo = selectedAudioTrack
    ? formatAudioSummary(selectedAudioTrack, i18n.language)
    : undefined;

  const mediaFormatBadges = useMemo(
    () =>
      effectiveVideo && library
        ? getMediaFormatBadges(effectiveVideo.videoTracks, selectedAudioTrack)
        : [],
    [effectiveVideo, library, selectedAudioTrack],
  );

  const movieSubtitleInfo = useMemo(() => {
    if (!effectiveVideo || !library) return undefined;
    const track = getSubtitleTrack(
      library.preferSubLan ?? '',
      library.subsMode ?? 'autoSubs',
      effectiveVideo,
      i18n.language,
      library.preferAudioLan,
    );
    if (typeof track === 'string') return t('none');
    return track ? formatSubtitleSummary(track, i18n.language, t('forcedTrack')) : undefined;
  }, [effectiveVideo, library, i18n.language, t]);

  const movieProgress = getWatchProgress(selectedVideo, currentUser?.id);

  if (!isLoading && !movie) return <span>Movie not found</span>;

  return (
    <DetailsWithRelatedContent
      collectionId={collectionId}
      currentItemId={movie?.id}
      currentItemType="movie"
      libraryType={libraryType}
      background={
        <>
          {!!movie?.id && (
            <DetailsBackgroundPlayback
              audioLocalIds={[movie.id]}
              videoLocalIds={[movie.id]}
              onVideoVisibilityChange={setIsBackgroundVideoVisible}
            />
          )}
          <DetailsBackgroundLayers
            imageSrc={backgroundImageSrc}
            isHidden={isBackgroundVideoVisible}
          />
        </>
      }
    >
      <Page justify="end" padding="4dvh 0" fullScreen>
        <DetailsInfo
          details={details}
          subtitle={movie?.videos && movie.videos.length > 1 ? selectedVideo?.title : undefined}
          expandedImageSrc={details?.coverSrc ?? movie?.coverSrc}
          expandedTitle={details?.title ?? movie?.name}
          cast={movie?.cast}
          infoItems={[
            (details?.year ?? movie?.year ?? '').split('-')[0],
            selectedVideo ? formatTimeForView(selectedVideo.runtime ?? 0) : '',
          ].filter(Boolean)}
          durationInfo={movieProgress?.duration}
          timeWatchedInfo={movieProgress?.timeWatched}
          audioInfo={movieAudioInfo}
          subtitleInfo={movieSubtitleInfo}
          videoInfo={effectiveVideo?.videoTracks?.[0]?.displayTitle}
          mediaFormatBadges={mediaFormatBadges}
          handlePlay={handlePlay}
          handlePlayFromStart={handlePlayFromStart}
          handleMarkWatched={handleMarkWatched}
          handleMoreOptions={() => setIsOptionsOpen(true)}
          displayOptions={{
            isWatched,
          }}
        />
      </Page>
      {isOptionsOpen && (
        <DetailsOptionsMenu
          title={details?.title ?? movie?.name}
          video={effectiveVideo}
          preferences={{
            preferAudioLan: library?.preferAudioLan ?? '',
            preferSubLan: library?.preferSubLan ?? '',
            subsMode: library?.subsMode ?? 'autoSubs',
          }}
          onVideoChange={(video) =>
            setResolvedVideoData((prev) => new Map(prev).set(video.id, video))
          }
          onClose={() => setIsOptionsOpen(false)}
        />
      )}
    </DetailsWithRelatedContent>
  );
}

export default memo(MovieDetails);
