import { applyUserImages } from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import type { Request as ExpressRequest } from 'express';
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
import { UserVideoPreferencesService } from '@/api/v1/shared/infrastructure/services/UserVideoPreferencesService';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import { useCases } from '@/api/v1/shared/infrastructure/adapters/di/container';
import {
  BadRequestException,
  NotFoundException,
} from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import { getUserId } from '@/utils/auth';
import type { IncludeType } from '@/types/common';
import type { SetSeasonWatchStateDTO, UpdateSeasonDTO } from '@seerial/domain';
import type { Season } from '../../../domain/Season';

type AuthenticatedRequest = ExpressRequest & { user?: { id?: string } };

@Route('seasons')
@Tags('Seasons')
export class SeasonsController extends Controller {
  /**
   * Get season details by ID
   */
  @Get('{id}')
  @Security('cookieAuth')
  public async get(
    @Path() id: string,
    @Request() req: ExpressRequest,
    @Query() include?: IncludeType,
  ): Promise<ApiResponse<Season>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'season', id);
    const result = await useCases.getSeasonById().execute(id, include);

    if (!result) {
      throw new NotFoundException(messages.errors.notFound.season);
    }

    await UserVideoPreferencesService.overlay(getUserId(req), result);
    return ApiResponse.success(result, messages.success.fetch);
  }

  /**
   * Update season details
   */
  @Patch('{id}')
  @Security('adminAuth')
  public async update(
    @Path() id: string,
    @Body() body: UpdateSeasonDTO,
  ): Promise<ApiResponse<Season>> {
    const data = await applyUserImages('season', id, body);
    const result = await useCases.updateSeason().execute(id, data);
    return ApiResponse.success(result, messages.success.update);
  }

  /**
   * Delete a season
   */
  @Delete('{id}')
  @Security('adminAuth')
  public async delete(@Path() id: string): Promise<ApiResponse<null>> {
    await useCases.deleteSeason().execute(id);
    return ApiResponse.success(null, messages.success.delete);
  }

  /**
   * Set season watch state for a user
   */
  @Post('{id}/watch-state')
  @Security('cookieAuth')
  public async setWatchState(
    @Path() id: string,
    @Body() body: SetSeasonWatchStateDTO,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<null>> {
    const { watched } = body;
    const userId = getUserId(req);
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'season', id);

    const season = await useCases.getSeasonById().execute(id, 'few');

    if (!season) {
      throw new NotFoundException(messages.errors.notFound.season);
    }

    await useCases.setSeasonWatchState().execute(id, userId, watched);

    return ApiResponse.success(null, messages.success.update);
  }
}
