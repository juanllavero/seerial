import type { LibraryItem, LibrarySummary } from '@seerial/domain';
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
import { useCases } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { AccessControlService } from '@/api/v1/shared/infrastructure/services/AccessControlService';
import {
  NotFoundException,
  RepositoryException,
} from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import { getUserId } from '@/utils/auth';
import type {
  CreateLibraryDTO,
  ReorderItemsDTO,
  ReorderLibrariesDTO,
  UpdateLibraryDTO,
} from '../../../application/dtos/LibraryDTOs';
import type { Library } from '../../../domain/Library';

/**
 * Removes the scan bookkeeping from a library and, for non-admin users, the server folder paths.
 */
const toLibrarySummary = (library: Library, isAdmin: boolean): LibrarySummary => {
  const { analyzedFiles: _files, analyzedFolders: _folders, ...summary } = library;
  return isAdmin ? summary : { ...summary, folders: [] };
};

@Route('libraries')
@Tags('Libraries')
export class LibrariesController extends Controller {
  /**
   * Get the libraries the current user can read (all of them for admins)
   */
  @Get()
  @Security('cookieAuth')
  public async getAll(@Request() req: ExpressRequest): Promise<ApiResponse<LibrarySummary[]>> {
    const user = AccessControlService.requireUser(req);
    const libraries = await useCases.getLibraries().execute();
    const allowed = await AccessControlService.getAllowedLibraryIds(user);
    const visible = allowed === null ? libraries : libraries.filter((l) => allowed.includes(l.id));
    const isAdmin = AccessControlService.isAdmin(user);
    return ApiResponse.success(
      visible.map((library) => toLibrarySummary(library, isAdmin)),
      messages.success.fetch,
    );
  }

  /**
   * Get library by ID
   */
  @Get('{id}')
  @Security('cookieAuth')
  public async getById(
    @Path() id: string,
    @Request() req: ExpressRequest,
  ): Promise<ApiResponse<LibrarySummary>> {
    const user = AccessControlService.requireUser(req);
    await AccessControlService.assertLibrary(user, id);

    const library = await useCases.getLibrary().execute(id);
    if (!library) {
      throw new NotFoundException(messages.errors.notFound.library);
    }

    return ApiResponse.success(
      toLibrarySummary(library, AccessControlService.isAdmin(user)),
      messages.success.fetch,
    );
  }

  /**
   * Get library content
   */
  @Get('{id}/content')
  @Security('cookieAuth')
  public async getContent(
    @Path() id: string,
    @Request() req: ExpressRequest,
    @Query() watched?: boolean,
  ): Promise<ApiResponse<LibraryItem[]>> {
    const userId = getUserId(req);
    await AccessControlService.assertLibrary(AccessControlService.requireUser(req), id);
    const content = await useCases.getLibraryContent().execute(id, userId, watched);
    if (!content) {
      throw new NotFoundException(messages.errors.notFound.library);
    }

    return ApiResponse.success(content, messages.success.fetch);
  }

  /**
   * Start library scan
   */
  @Post('{id}/scan')
  @Security('adminAuth')
  public async startScan(@Path() id: string): Promise<ApiResponse<LibrarySummary>> {
    const library = await useCases.getLibrary().execute(id);

    if (!library) {
      throw new NotFoundException(messages.errors.notFound.library);
    }

    await useCases.scanLibrary().execute(library, false);

    return ApiResponse.success(toLibrarySummary(library, true), messages.success.scan);
  }

  /**
   * Create a new library
   */
  @Post()
  @Security('adminAuth')
  public async create(@Body() body: CreateLibraryDTO): Promise<ApiResponse<LibrarySummary>> {
    // The scanLibrary useCase expects a full Library object, so we need to create a temporary one
    const tempLibrary = {
      ...body,
      id: '',
      order: 0,
      hidden: false,
      analyzedFiles: {},
      analyzedFolders: {},
      backgroundSrc: '',
      series: [],
      movies: [],
      albums: [],
      collections: [],
      numberOfItems: 0,
    };

    const library = await useCases.scanLibrary().execute(tempLibrary, true);

    if (!library) {
      throw new NotFoundException(messages.errors.notFound.library);
    }

    return ApiResponse.success(toLibrarySummary(library, true), messages.success.create);
  }

  /**
   * Reorder libraries.
   * Declared before the `{id}` PATCH route so `/order` is not captured as an id.
   */
  @Patch('order')
  @Security('adminAuth')
  public async reorder(@Body() body: ReorderLibrariesDTO): Promise<ApiResponse<boolean>> {
    const { orderedLibraryIds } = body;
    const result = await useCases.reorderLibraries().execute(orderedLibraryIds);

    // The repository reports failures with `false`: do not answer 200 for an order that was not applied
    if (!result) throw new RepositoryException('Libraries could not be reordered');

    return ApiResponse.success(result, messages.success.order);
  }

  /**
   * Update library details
   */
  @Patch('{id}')
  @Security('adminAuth')
  public async update(
    @Path() id: string,
    @Body() body: UpdateLibraryDTO,
  ): Promise<ApiResponse<LibrarySummary>> {
    const result = await useCases.updateLibrary().execute(id, body);

    return ApiResponse.success(toLibrarySummary(result, true), messages.success.update);
  }

  /**
   * Delete a library
   */
  @Delete('{id}')
  @Security('adminAuth')
  public async delete(@Path() id: string): Promise<ApiResponse<null>> {
    await useCases.deleteLibrary().execute(id);

    return ApiResponse.success(null, messages.success.delete);
  }

  /**
   * Reorder library items
   */
  @Patch('{id}/order')
  @Security('adminAuth')
  public async reorderItems(
    @Path() id: string,
    @Body() body: ReorderItemsDTO,
  ): Promise<ApiResponse<boolean>> {
    const { orderedItems } = body;

    const result = await useCases.reorderLibraryItems().execute(id, orderedItems);

    if (!result) throw new RepositoryException('Library items could not be reordered');

    return ApiResponse.success(result, messages.success.order);
  }
}
