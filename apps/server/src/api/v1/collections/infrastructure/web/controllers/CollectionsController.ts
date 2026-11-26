import { applyUserImages } from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import type { Collection, UpdateCollectionDTO } from '@seerial/domain';
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
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import { getUserId } from '@/utils/auth';
import type {
  CollectionContentDTO,
  CollectionSummaryDTO,
  CreateCollectionWithItemDTO,
  MusicExtrasDTO,
  ReorderContentDTO,
} from '../../../application/dtos/CollectionDTOs';

@Route('collections')
@Tags('Collections')
export class CollectionsController extends Controller {
  /**
   * Get all collections (id and title only)
   */
  @Get()
  @Security('cookieAuth')
  public async getAll(@Request() req: ExpressRequest): Promise<ApiResponse<CollectionSummaryDTO[]>> {
    const user = AccessControlService.requireUser(req);
    const all = await useCases.getAllCollections().execute();
    const visibleIds = new Set(
      await AccessControlService.filterCollectionIds(
        user,
        all.map((collection) => collection.id),
      ),
    );
    const collections = all.filter((collection) => visibleIds.has(collection.id));

    return ApiResponse.success(collections, messages.success.fetch);
  }

  /**
   * Create a collection with an initial item (movie, series or album)
   */
  @Post()
  @Security('adminAuth')
  public async create(
    @Body() body: CreateCollectionWithItemDTO,
  ): Promise<ApiResponse<Collection>> {
    const collection = await useCases.createCollectionWithItem().execute(body);

    return ApiResponse.success(collection, messages.success.create);
  }

  /**
   * Get music extras for a collection
   */
  @Get('{collectionId}/music-extras')
  @Security('cookieAuth')
  public async getMusicExtras(
    @Path() collectionId: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<MusicExtrasDTO[]>> {
    await AccessControlService.assertAccess(
      AccessControlService.requireUser(req),
      'collection',
      collectionId,
    );
    const musicExtras = await useCases.getMusicExtras().execute(collectionId);

    return ApiResponse.success(musicExtras, messages.success.fetch);
  }

  /**
   * Get collection content items (movies, series, albums)
   */
  @Get('{collectionId}/content')
  @Security('cookieAuth')
  public async getCollectionContent(
    @Path() collectionId: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<CollectionContentDTO>> {
    const userId = getUserId(req);
    const user = AccessControlService.requireUser(req);
    await AccessControlService.assertAccess(user, 'collection', collectionId);
    const content = await useCases.getCollectionContent().execute(collectionId, userId);

    // A collection can mix libraries: hide the items of the ones the user cannot read
    return ApiResponse.success(
      {
        movies: await AccessControlService.filterItemsByLibrary(user, 'movie', content.movies),
        series: await AccessControlService.filterItemsByLibrary(user, 'series', content.series),
        albums: await AccessControlService.filterItemsByLibrary(user, 'album', content.albums),
      },
      messages.success.fetch,
    );
  }

  /**
   * Add a movie to a collection
   */
  @Post('{id}/movies/{movieId}')
  @Security('adminAuth')
  public async addMovie(@Path() id: string, @Path() movieId: string): Promise<ApiResponse<null>> {
    await useCases.addMovieToCollection().execute(id, movieId);

    return ApiResponse.success(null, messages.success.create);
  }

  /**
   * Add a series to a collection
   */
  @Post('{id}/series/{seriesId}')
  @Security('adminAuth')
  public async addSeries(@Path() id: string, @Path() seriesId: string): Promise<ApiResponse<null>> {
    await useCases.addSeriesToCollection().execute(id, seriesId);

    return ApiResponse.success(null, messages.success.create);
  }

  /**
   * Add an album to a collection
   */
  @Post('{id}/albums/{albumId}')
  @Security('adminAuth')
  public async addAlbum(@Path() id: string, @Path() albumId: string): Promise<ApiResponse<null>> {
    await useCases.addAlbumToCollection().execute(id, albumId);

    return ApiResponse.success(null, messages.success.create);
  }

  /**
   * Remove a movie from a collection
   */
  @Delete('{id}/movies/{movieId}')
  @Security('adminAuth')
  public async removeMovie(
    @Path() id: string,
    @Path() movieId: string,
  ): Promise<ApiResponse<null>> {
    await useCases.removeMovieFromCollection().execute(id, movieId);

    return ApiResponse.success(null, messages.success.delete);
  }

  /**
   * Remove a series from a collection
   */
  @Delete('{id}/series/{seriesId}')
  @Security('adminAuth')
  public async removeSeries(
    @Path() id: string,
    @Path() seriesId: string,
  ): Promise<ApiResponse<null>> {
    await useCases.removeSeriesFromCollection().execute(id, seriesId);

    return ApiResponse.success(null, messages.success.delete);
  }

  /**
   * Remove an album from a collection
   */
  @Delete('{id}/albums/{albumId}')
  @Security('adminAuth')
  public async removeAlbum(
    @Path() id: string,
    @Path() albumId: string,
  ): Promise<ApiResponse<null>> {
    await useCases.removeAlbumFromCollection().execute(id, albumId);

    return ApiResponse.success(null, messages.success.delete);
  }

  /**
   * Reorder items in a collection
   */
  @Post('{id}/items/order')
  @Security('adminAuth')
  public async reorderContent(
    @Path() id: string,
    @Body() body: ReorderContentDTO,
  ): Promise<ApiResponse<null>> {
    const { orderedItems } = body;

    await useCases.reorderCollectionItems().execute(id, orderedItems);

    return ApiResponse.success(null, messages.success.order);
  }

  /**
   * Get collection by ID
   */
  @Get('{id}')
  @Security('cookieAuth')
  public async get(
    @Path() id: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<Collection | null>> {
    await AccessControlService.assertAccess(AccessControlService.requireUser(req), 'collection', id);
    const collection = await useCases.getCollectionById().execute(id);
    return ApiResponse.success(collection, messages.success.fetch);
  }

  /**
   * Update collection details
   */
  @Patch('{id}')
  @Security('adminAuth')
  public async update(
    @Path() id: string,
    @Body() body: UpdateCollectionDTO,
  ): Promise<ApiResponse<Collection>> {
    const data = await applyUserImages('collection', id, body);
    const result = await useCases.updateCollection().execute(id, data);

    return ApiResponse.success(result, messages.success.update);
  }

  /**
   * Delete a collection
   */
  @Delete('{id}')
  @Security('adminAuth')
  public async delete(@Path() id: string): Promise<ApiResponse<null>> {
    await useCases.deleteCollection().execute(id);

    return ApiResponse.success(null, messages.success.delete);
  }
}
