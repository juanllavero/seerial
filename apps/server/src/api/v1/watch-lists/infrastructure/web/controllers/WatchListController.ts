import type { Request as ExpressRequest } from 'express';
import { Body, Controller, Patch, Request, Route, Security, Tags } from 'tsoa';
import { useCases } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import type { UpdateWatchStateDTO } from '../../../application/dtos/WatchListDTOs';

@Route('watch-lists')
@Tags('Watch Lists')
export class WatchListController extends Controller {
  /**
   * Update watch state for a video
   */
  @Patch('watch-state')
  @Security('cookieAuth')
  public async updateWatchState(
    @Body() body: UpdateWatchStateDTO,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<null>> {
    const { videoId, timeWatched, watched } = body;
    const user = AccessControlService.requireUser(req);
    await AccessControlService.assertAccess(user, 'video', videoId);
    const userId = user.id;

    await useCases.updateWatchStateUseCase().execute({
      videoId,
      timeWatched,
      watched,
      userId,
    });

    return ApiResponse.success(null, messages.success.update);
  }
}
