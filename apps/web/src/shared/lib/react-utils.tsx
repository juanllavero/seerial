import { API, useCreate } from '@seerial/api';
import type { Collection, Video } from '@seerial/domain';
import { useWebSocketStore } from '@seerial/stores';
import { useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { toast } from 'sonner';
import { ScreenHeight } from '@/shared/data/enums/screen';
import Image from '@/shared/ui/image';
import { iso1to3 } from '@/shared/lib/utils';

const tailwindSizes = [40, 48, 56, 60, 64, 72, 80, 96, 100, 112, 120, 128, 144, 160, 192];

export const getVideoProgress = (runtime: number, watchedTime?: number) => {
  const timeWatched = watchedTime ? watchedTime / 60 : 0;
  const duration = runtime ?? 0;

  if (duration > 0 && timeWatched > 0) {
    return duration - timeWatched;
  }

  return undefined;
};

export const useMediaActions = () => {
  const queryClient = useQueryClient();
  const connectWS = useWebSocketStore((state) => state.connectWS);
  const { create } = useCreate<unknown>();

  const invalidateAllQueries = () => queryClient.invalidateQueries();

  const toggleMovieWatched = async (id: string, newState: boolean, _userId?: string) => {
    // The server takes the user from the session token
    await create(API.movies.setWatchState(id), { watched: newState });
    await invalidateAllQueries();
  };

  const toggleSeriesWatched = async (id: string, newState: boolean, _userId?: string) => {
    await create(API.series.setWatchState(id), { watched: newState });
    await invalidateAllQueries();
  };

  const refreshMetadata = async (type: 'show' | 'movie', id: string) => {
    await connectWS();

    const response =
      type === 'show'
        ? await create(API.series.refreshMetadata, { id })
        : await create(API.movies.refreshMetadata(id), {});

    if (!response) {
      showToast('error', t('refreshMetadataError'));
      return;
    }

    showToast('info', t('refreshMetadataStart'));
    await invalidateAllQueries();
  };

  return {
    refreshMetadata,
    toggleMovieWatched,
    toggleSeriesWatched,
  };
};

export const getCoverSize = (
  screenHeight: ScreenHeight,
  isPoster: boolean,
  isBackground: boolean,
) => {
  let height: number;

  switch (screenHeight) {
    case ScreenHeight.HD:
      height = 60;
      break;
    case ScreenHeight.FHD:
      height = 80;
      break;
    case ScreenHeight.QHD:
      height = 100;
      break;
    case ScreenHeight.UHD:
      height = 120;
      break;
    default:
      return 'w-60 h-60';
  }

  let aspectRatio = 1;

  if (isPoster) {
    aspectRatio = 2 / 3;
  } else if (isBackground) {
    aspectRatio = 16 / 9;
  }

  const idealWidth = height * aspectRatio;

  const closestWidth = tailwindSizes.reduce((prev, curr) =>
    Math.abs(curr - idealWidth) < Math.abs(prev - idealWidth) ? curr : prev,
  );

  return `w-${closestWidth} h-${height}`;
};

export const getTitleSize = (screenHeight: ScreenHeight, isMobile: boolean) => {
  if (isMobile) {
    return 'text-3xl';
  }

  switch (screenHeight) {
    case ScreenHeight.HD:
      return 'text-3xl';
    case ScreenHeight.FHD:
      return 'text-4xl';
    case ScreenHeight.QHD:
      return 'text-5xl';
    case ScreenHeight.UHD:
      return 'text-6xl';
  }
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const monthOptions: Intl.DateTimeFormatOptions = { month: 'short' };
  const month = date.toLocaleString('en-US', monthOptions);
  const day = date.getDate();
  const year = date.getFullYear();

  return `${month} ${day}, ${year}`;
};

export const formatTime = (time: number) => {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = Math.floor(time % 60);

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

export const formatTimeForView = (time: number) => {
  const hours = Math.floor(time / 60);
  const minutes = Math.floor(time % 60);

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${hours}h`;
  }

  return `${minutes}m`;
};

export const getOnlyYear = (date: string) => {
  const year = new Date(date).getFullYear();
  return year;
};

export const getEpisodeGroupType = (type: number) => {
  switch (type) {
    case 1:
      return 'Original air date';
    case 2:
      return 'Absolute';
    case 3:
      return 'DVD';
    case 4:
      return 'Digital';
    case 5:
      return 'Story arc';
    case 6:
      return 'Production';
    case 7:
      return 'TV';
    default:
      return 'Unknown';
  }
};

export const getAudioTrack = (prefAudioLan: string, video: Video) => {
  if (!video.audioTracks || video.audioTracks.length === 0) {
    return null;
  }

  if (
    video.selectedAudioTrack &&
    video.selectedAudioTrack !== -1 &&
    video.selectedAudioTrack < video.audioTracks.length
  ) {
    return video.audioTracks[video.selectedAudioTrack];
  }

  if (prefAudioLan !== '') {
    const track = video.audioTracks.find((track) => track.language === prefAudioLan);
    if (track) {
      return track;
    }
  }

  return video.audioTracks[0];
};

export const getSubtitleTrack = (prefSubsLan: string, subsMode: string, video: Video) => {
  if (!video.subtitleTracks || video.subtitleTracks.length === 0) {
    return null;
  }

  if (
    video.selectedSubtitleTrack &&
    video.selectedSubtitleTrack !== -1 &&
    video.selectedSubtitleTrack < video.subtitleTracks.length
  ) {
    return video.subtitleTracks[video.selectedSubtitleTrack];
  }

  const targetLang = iso1to3[prefSubsLan] ?? prefSubsLan;

  const defaultTrack =
    subsMode === 'alwaysSubs'
      ? video.subtitleTracks.length > 0
        ? video.subtitleTracks[0]
        : null
      : null;

  switch (subsMode) {
    case 'autoSubs':
    case 'alwaysSubs':
      return video.subtitleTracks.findLast((track) => track.languageTag === targetLang) ?? defaultTrack;
    default:
      return null;
  }
};

export const generateRandoumUUID = () => {
  const array = new Uint8Array(4);
  window.crypto.getRandomValues(array);
  return Array.from(array)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const showToast = (
  type: 'success' | 'error' | 'warning' | 'info' | 'message' | 'default' = 'default',
  message: string,
  title?: string,
  duration?: number,
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right',
) => {
  switch (type) {
    case 'message':
      toast.message(title, {
        description: message,
        duration,
        position,
      });
      break;
    case 'success':
      toast.success(message, {
        duration,
        position,
      });
      break;
    case 'error':
      toast.error(message, {
        duration,
        position,
      });
      break;
    case 'warning':
      toast.warning(message, {
        duration,
        position,
      });
      break;
    case 'info':
      toast.info(message, {
        duration,
        position,
      });
      break;
    case 'default':
      toast(message, {
        duration,
        position,
      });
      break;
  }
};

export const showPromiseToast = (
  promise: Promise<unknown>,
  loadingMessage: string,
  successMessage: string,
  errorMessage: string,
) => {
  toast.promise(promise, {
    loading: loadingMessage,
    success: () => successMessage,
    error: errorMessage,
  });
};

export const isAbsolutePath = (pathString: string): boolean => {
  const windowsPathRegex = /^[a-zA-Z]:[\\/]/;
  const unixPathRegex = /^\//;

  return windowsPathRegex.test(pathString) || unixPathRegex.test(pathString);
};

export const getFirstImage = (collection: Collection, type: string) => {
  if (type === 'Movies' && collection.movies && collection.movies.length > 0) {
    return collection.movies[0].coverSrc;
  }

  if (type === 'Series' && collection.shows && collection.shows.length > 0) {
    return collection.shows[0].coverSrc;
  }

  if (type === 'Music' && collection.albums && collection.albums.length > 0) {
    return collection.albums[0].coverSrc;
  }

  return '';
};

export const getPosterImage = (collectionId: string, images: string[], type: string) => {
  if (images.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Image
          key={`Placeholder image for ${type} collection ${collectionId}`}
          src={type === 'Music' ? '/img/songDefault.png' : '/img/fileNotFound.jpg'}
          alt={`Collection item ${collectionId}`}
          className="h-full w-full object-cover"
          aspectRatio={type === 'Music' ? 1 : 2 / 3}
        />
      </div>
    );
  }

  if (images.length > 1 && images.length < 4) {
    const placeholdersNeeded = 4 - images.length;
    for (let i = 0; i < placeholdersNeeded; i++) {
      images.push(`/img/${type === 'Music' ? 'songDefault.png' : 'fileNotFound.jpg'}`);
    }
  }

  const gridClass = 'grid-cols-2';

  if (images.length === 1) {
    return undefined;
  }

  return (
    <div className={`grid ${gridClass} h-full w-full gap-1`}>
      {images.map((src, index) => (
        <Image
          key={index}
          url={src}
          alt={`Collection item ${index + 1}`}
          className="h-full w-full object-cover"
          fallbackSrc={type === 'Music' ? '/img/songDefault.png' : '/img/fileNotFound.jpg'}
          aspectRatio={type === 'Music' ? 1 : 2 / 3}
        />
      ))}
    </div>
  );
};
