import type { ContinueWatchingVideoDTO } from '@seerial/domain';
import type { Request as ExpressRequest } from 'express';
import { Controller, Get, Request, Route, Security, Tags } from 'tsoa';
import { useCases } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { getUserId } from '@/utils/auth';

@Route('continue-watching')
@Tags('Continue Watching')
export class ContinueWatchingController extends Controller {
  @Get()
  @Security('cookieAuth')
  public async getVideos(
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<ContinueWatchingVideoDTO[]>> {
    const userId = getUserId(req);
    const user = AccessControlService.requireUser(req);
    const videos = await useCases.getContinueWatchingVideos().execute(userId);

    // Access may have been revoked after the video was started
    const visible: typeof videos = [];
    for (const video of videos) {
      if (await AccessControlService.canAccess(user, 'video', video.videoId)) visible.push(video);
    }
    return ApiResponse.success(visible);
  }
}
