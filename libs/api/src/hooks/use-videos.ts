import { API } from '../endpoints'
import { type ApiMutationResult, type ApiQueryResult, asBody, asVoid, type MutationHookOptions, type QueryHookOptions, useApiMutation, useApiQuery } from './common'

export const useGetVideo = <TResponse = unknown>(
    videoId: string,
    options?: QueryHookOptions<TResponse>,
): ApiQueryResult<TResponse> => useApiQuery<TResponse>(['videos', 'get', videoId], API.videos.get(videoId), options)

export const useGetVideoPlaybackInfo = <TResponse = unknown>(
    videoId: string,
    options?: QueryHookOptions<TResponse>,
): ApiQueryResult<TResponse> =>
    useApiQuery<TResponse>(['videos', 'getPlaybackInfo', videoId], API.videos.getPlaybackInfo(videoId), options)

export const useGetVideoByEpisodeId = <TResponse = unknown>(
    episodeId: string,
    options?: QueryHookOptions<TResponse>,
): ApiQueryResult<TResponse> =>
    useApiQuery<TResponse>(['videos', 'getByEpisodeId', episodeId], API.videos.getByEpisodeId(episodeId), options)

export const useGetVideoMediaInfo = <TResponse = unknown>(
    videoId: string,
    options?: QueryHookOptions<TResponse>,
): ApiQueryResult<TResponse> =>
    useApiQuery<TResponse>(['videos', 'getMediaInfo', videoId], API.videos.getMediaInfo(videoId), options)

export const useGetVideoChapterThumbnails = <TResponse = unknown>(
    videoId: string,
    options?: QueryHookOptions<TResponse>,
): ApiQueryResult<TResponse> =>
    useApiQuery<TResponse>(
        ['videos', 'chapterThumbnails', videoId],
        API.videos.chapterThumbnails(videoId),
        options,
    )

export const useUpdateVideo = <TResponse = unknown, TBody = unknown>(
    videoId: string,
    options?: MutationHookOptions<TResponse, TBody>,
): ApiMutationResult<TResponse, TBody> =>
    useApiMutation<TResponse, TBody>(['videos', 'update', videoId], API.videos.update(videoId), 'PATCH', asBody, options)

export const useDeleteVideo = <TResponse = unknown>(
    videoId: string,
    options?: MutationHookOptions<TResponse, void>,
): ApiMutationResult<TResponse, void> =>
    useApiMutation<TResponse, void>(['videos', 'delete', videoId], API.videos.delete(videoId), 'DELETE', asVoid, options)

export const useUpdateVideoMediaInfo = <TResponse = unknown>(
    videoId: string,
    options?: MutationHookOptions<TResponse, void>,
): ApiMutationResult<TResponse, void> =>
    useApiMutation<TResponse, void>(
        ['videos', 'updateMediaInfo', videoId],
        API.videos.updateMediaInfo(videoId),
        'GET',
        asVoid,
        options,
    )

/** Saves the audio/subtitle track the current user picked (only affects that user). */
export const useSetVideoTrackSelection = <TResponse = unknown, TBody = unknown>(
    videoId: string,
    options?: MutationHookOptions<TResponse, TBody>,
): ApiMutationResult<TResponse, TBody> =>
    useApiMutation<TResponse, TBody>(
        ['videos', 'trackSelection', videoId],
        API.videos.trackSelection(videoId),
        'PATCH',
        asBody,
        options,
    )

export const useSetVideoWatchState = <TResponse = unknown, TBody = unknown>(
    videoId: string,
    options?: MutationHookOptions<TResponse, TBody>,
): ApiMutationResult<TResponse, TBody> =>
    useApiMutation<TResponse, TBody>(
        ['videos', 'setWatchState', videoId],
        API.videos.setWatchState(videoId),
        'POST',
        asBody,
        options,
    )

