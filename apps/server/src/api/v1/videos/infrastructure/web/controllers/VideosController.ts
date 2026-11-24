import type { Chapter, PlayBackInfo, Video } from '@seerial/domain';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from 'tsoa';
import {
  useCases,
  videoExtractionService,
} from '@/api/v1/shared/infrastructure/adapters/di/container';
import { getChapters } from '@/api/v1/shared/infrastructure/adapters/ffmpeg/mediaInfo';
import {
  BadRequestException,
  NotFoundException,
} from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import { getUserId } from '@/utils/auth';
import type { SetVideoWatchStateDTO, UpdateVideoDTO } from '../../../application/dtos/VideoDTOs';

type TsoaContext = { response: ExpressResponse };
type AuthenticatedRequest = ExpressRequest & { user?: { id?: string } };

@Route('videos')
@Tags('Videos')
export class VideosController extends Controller {
  // Static routes must be declared before `{id}`, which would otherwise capture them.

  /**
   * Extract video thumbnail
   */
  @Get('thumbnail')
  @Security('adminAuth')
  public async getVideoThumbnail(@Query() url: string, @Query() time?: string): Promise<void> {
    await videoExtractionService.streamVideoThumbnail(
      url,
      time || '10',
      (this as unknown as TsoaContext).response,
    );
  }

  /**
   * Extract subtitle track from video
   */
  @Get('subtitles')
  @Security('adminAuth')
  public async getSubsFromVideo(
    @Query() videoPathParam: string,
    @Query() trackId: number,
    @Query() startTime?: number,
  ): Promise<void> {
    await videoExtractionService.streamVideoSubtitles(
      videoPathParam,
      trackId,
      startTime || 0,
      (this as unknown as TsoaContext).response,
    );
  }

  /**
   * Get video details by ID
   */
  @Get('{id}')
  @Security('cookieAuth')
  public async get(
    @Path() id: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<Video>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'video', id);
    const result = await useCases.getVideoById().execute(id);

    if (!result) {
      throw new NotFoundException(messages.errors.notFound.video);
    }

    return ApiResponse.success(result, messages.success.fetch);
  }

  /**
   * Get video by episode ID
   */
  @Get('by-episode/{episodeId}')
  @Security('cookieAuth')
  public async getByEpisodeId(
    @Path() episodeId: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<Video>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'episode', episodeId);
    const result = await useCases.getVideoByEpisodeId().execute(episodeId);

    if (!result) {
      throw new NotFoundException(messages.errors.notFound.video);
    }

    return ApiResponse.success(result, messages.success.fetch);
  }

  /**
   * Get video info for playback (including media info and playback preferences)
   */
  @Get('playback-info/{id}')
  @Security('cookieAuth')
  public async getPlaybackInfo(
    @Path() id: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<PlayBackInfo>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'video', id);
    const result = await useCases.getVideoPlaybackInfo().execute(id);

    if (!result) {
      throw new NotFoundException(messages.errors.notFound.video);
    }

    return ApiResponse.success(result, messages.success.fetch);
  }

  /**
   * Update video details
   */
  @Patch('{id}')
  @Security('adminAuth')
  public async update(
    @Path() id: string,
    @Body() body: UpdateVideoDTO,
  ): Promise<ApiResponse<Video>> {
    const result = await useCases.updateVideo().execute(id, body);
    return ApiResponse.success(result, messages.success.update);
  }

  /**
   * Delete a video
   */
  @Delete('{id}')
  @Security('adminAuth')
  public async delete(@Path() id: string): Promise<ApiResponse<null>> {
    await useCases.deleteVideo().execute(id);
    return ApiResponse.success(null, messages.success.delete);
  }

  /**
   * Update video media info
   */
  @Get('{id}/media-info')
  @Security('adminAuth')
  public async updateMediaInfo(@Path() id: string): Promise<ApiResponse<null>> {
    const _result = await useCases.updateMediaInfo().execute(id);
    return ApiResponse.success(null, messages.success.update);
  }

  /**
   * Set video watch state for a user
   */
  @Post('{id}/watch-state')
  @Security('cookieAuth')
  public async setWatchState(
    @Path() id: string,
    @Body() body: SetVideoWatchStateDTO,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<null>> {
    const { watched } = body;
    const userId = getUserId(req);
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'video', id);

    const video = await useCases.getVideoById().execute(id);

    if (!video) {
      throw new NotFoundException(messages.errors.notFound.video);
    }

    if (watched) {
      await useCases.addVideoToWatchList().execute(userId, id);
    } else {
      await useCases.removeVideoFromWatchList().execute(userId, id);
    }
    await useCases.updateVideo().execute(video.id, video);

    return ApiResponse.success(null, messages.success.update);
  }

  /**
   * Get or generate chapter thumbnails for a video.
   * Thumbnails are stored on disk and reused on subsequent requests.
   */
  @Get('{id}/chapter-thumbnails')
  @Security('cookieAuth')
  public async getChapterThumbnails(
    @Path() id: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<Chapter[]>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'video', id);
    const video = await useCases.getVideoById().execute(id);

    if (!video) {
      throw new NotFoundException(messages.errors.notFound.video);
    }

    const chapters = await getChapters(video.fileSrc);

    if (!chapters.length) {
      return ApiResponse.success([], messages.success.fetch);
    }

    const chaptersWithThumbnails = await videoExtractionService.generateChapterThumbnails(
      id,
      video.fileSrc,
      chapters,
    );

    return ApiResponse.success(chaptersWithThumbnails, messages.success.fetch);
  }
}
