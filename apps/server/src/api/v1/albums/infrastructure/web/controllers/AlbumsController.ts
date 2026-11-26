import { applyUserImages } from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import type { Request as ExpressRequest } from 'express';
import { Body, Controller, Delete, Get, Patch, Path, Request, Route, Security, Tags } from 'tsoa';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import { useCases } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import type { UpdateAlbumDTO } from '@seerial/domain';
import type { Album } from '../../../domain/Album';

@Route('albums')
@Tags('Albums')
export class AlbumsController extends Controller {
  /**
   * Get album by ID
   */
  @Get('{id}')
  @Security('cookieAuth')
  public async get(
    @Path() id: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<Album | null>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'album', id);
    const result = await useCases.getAlbumById().execute(id);

    return ApiResponse.success(result, messages.success.fetch);
  }

  /**
   * Update album details
   */
  @Patch('{id}')
  @Security('adminAuth')
  public async update(
    @Path() id: string,
    @Body() body: UpdateAlbumDTO,
  ): Promise<ApiResponse<Album>> {
    const data = await applyUserImages('album', id, body);
    const result = await useCases.updateAlbum().execute(id, data);

    return ApiResponse.success(result, messages.success.update);
  }

  /**
   * Delete an album
   */
  @Delete('{id}')
  @Security('adminAuth')
  public async delete(@Path() id: string): Promise<ApiResponse<null>> {
    await useCases.deleteAlbum().execute(id);

    return ApiResponse.success(null, messages.success.delete);
  }
}
