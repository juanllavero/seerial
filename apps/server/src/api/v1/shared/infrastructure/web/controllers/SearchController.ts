import type { LibrarySearchItem, MediaSearchResult } from '@seerial/domain';
import type { Request as ExpressRequest } from 'express';
import { Get, Query, Request, Route, Security, Tags } from 'tsoa';
import { messages } from '@/config/messages';
import { AccessControlService } from '../../services/AccessControlService';
import { externalSearchService, localLibrarySearchService } from '../../adapters/di/container';
import { ApiResponse } from '../http/APIResponse';

@Route('search')
@Tags('Search')
export class SearchController {
  /**
   * Search downloadable media in YouTube
   */
  @Get('media')
  @Security('adminAuth')
  public async searchDownloadableMedia(
    @Query() query: string,
  ): Promise<ApiResponse<MediaSearchResult[]>> {
    return ApiResponse.success(
      await externalSearchService.searchDownloadableMedia(query),
      messages.success.fetch,
    );
  }

  /**
   * Search local library content (collections, movies, series, albums, artists, episodes and songs).
   */
  @Get('library')
  @Security('cookieAuth')
  public async searchLibraryContent(
    @Query() query: string,
    @Request() req: ExpressRequest,
    @Query() limit?: number,
  ): Promise<ApiResponse<LibrarySearchItem[]>> {
    const user = AccessControlService.requireUser(req);
    const results = await localLibrarySearchService.search(query, limit);

    if (AccessControlService.isAdmin(user)) {
      return ApiResponse.success(results, messages.success.fetch);
    }

    // Normal users only see results from libraries (or playlists) they can read
    const visible: LibrarySearchItem[] = [];
    for (const item of results) {
      if (item.type === 'artist' || (await AccessControlService.canAccess(user, item.type, item.id))) {
        visible.push(item);
      }
    }
    return ApiResponse.success(visible, messages.success.fetch);
  }
}
