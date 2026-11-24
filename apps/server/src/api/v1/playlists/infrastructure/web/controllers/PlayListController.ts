import type { Request as ExpressRequest } from 'express';
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Request,
  Route,
  Security,
  Tags,
} from 'tsoa';
import { useCases } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import { NotFoundException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import type {
  AddSongToPlaylistDTO,
  CreatePlayListDTO,
  ReorderPlayListSongsDTO,
  UpdatePlayListDTO,
} from '../../../application/dtos/PlayListDTOs';
import type { PlayList } from '../../../domain/PlayList';

@Route('playlists')
@Tags('Playlists')
export class PlayListController extends Controller {
  /**
   * Get the playlists the current user can read.
   * Admins get all of them; other users get the playlists of the libraries they can access
   * plus the playlists an admin granted them.
   */
  @Get()
  @Security('cookieAuth')
  public async getAll(@Request() req: ExpressRequest): Promise<ApiResponse<PlayList[]>> {
    const user = AccessControlService.requireUser(req);
    const all = await useCases.getPlayLists().execute();

    if (AccessControlService.isAdmin(user)) {
      return ApiResponse.success(all, messages.success.fetch);
    }

    const [libraryIds, granted] = await Promise.all([
      AccessControlService.getAllowedLibraryIds(user),
      AccessControlService.getGrantedPlayListIds(user),
    ]);
    const visible = all.filter((playList) =>
      playList.libraryId
        ? (libraryIds ?? []).includes(playList.libraryId)
        : (granted ?? []).includes(playList.id),
    );
    return ApiResponse.success(visible, messages.success.fetch);
  }

  /**
   * Get playlist by ID
   */
  @Get('{id}')
  @Security('cookieAuth')
  public async getById(
    @Path() id: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<PlayList>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'playlist', id);
    const result = await useCases.getPlayListById().execute(id);

    if (!result) {
      throw new NotFoundException(messages.errors.notFound.playlist);
    }

    return ApiResponse.success(result, messages.success.fetch);
  }

  /**
   * Create a new playlist
   */
  @Post()
  @Security('adminAuth')
  public async create(
    @Body() body: CreatePlayListDTO,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<PlayList>> {
    // Playlists belong to the admin who created them; other users only read granted ones
    const result = await useCases.createPlayList().execute(body, req.user?.id);
    return ApiResponse.success(result, messages.success.create);
  }

  /**
   * Update playlist
   */
  @Patch('{id}')
  @Security('adminAuth')
  public async update(
    @Path() id: string,
    @Body() body: UpdatePlayListDTO,
  ): Promise<ApiResponse<PlayList>> {
    const result = await useCases.updatePlayList().execute(id, body);
    return ApiResponse.success(result, messages.success.update);
  }

  /**
   * Delete playlist
   */
  @Delete('{id}')
  @Security('adminAuth')
  public async delete(@Path() id: string): Promise<ApiResponse<null>> {
    await useCases.deletePlayList().execute(id);
    return ApiResponse.success(null, messages.success.delete);
  }

  /**
   * Add song to playlist
   */
  @Post('{id}/songs')
  @Security('adminAuth')
  public async addSong(
    @Path() id: string,
    @Body() body: AddSongToPlaylistDTO,
  ): Promise<ApiResponse<null>> {
    const { songId } = body;

    await useCases.addSongToPlayList().execute(id, songId);
    return ApiResponse.success(null, messages.success.create);
  }

  /**
   * Reorder the songs of a playlist (switches it from alphabetical to manual order)
   */
  @Patch('{id}/order')
  @Security('adminAuth')
  public async reorderSongs(
    @Path() id: string,
    @Body() body: ReorderPlayListSongsDTO,
  ): Promise<ApiResponse<boolean>> {
    const result = await useCases.reorderPlayListSongs().execute(id, body.orderedSongIds);
    return ApiResponse.success(result, messages.success.order);
  }

  /**
   * Remove song from playlist
   */
  @Delete('{id}/songs/{songId}')
  @Security('adminAuth')
  public async removeSong(@Path() id: string, @Path() songId: string): Promise<ApiResponse<null>> {
    await useCases.removeSongFromPlayList().execute(id, songId);
    return ApiResponse.success(null, messages.success.delete);
  }
}
