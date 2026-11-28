import { findContent } from '@/api/v1/shared/infrastructure/services/artwork/contentArtwork';
import {
  type ThemeKind,
  themeMediaSlot,
} from '@/api/v1/shared/infrastructure/services/artwork/themeMedia';
import path from 'node:path';
import { Body, Controller, Post, Route, Security, Tags } from 'tsoa';
import { messages } from '@/config/messages';
import { downloadImage, isValidURL } from '@/utils/utils';
import { downloaderService, fileSystemService } from '../../adapters/di/container';
import { BadRequestException } from '../exceptions/HTTPExceptions';
import { ApiResponse } from '../http/APIResponse';

interface DownloadThemeMediaDTO {
  url: string;
  owner: 'movie' | 'series' | 'season';
  id: string;
}

interface DownloadVideoDTO extends DownloadThemeMediaDTO {}

interface DownloadMusicDTO extends DownloadThemeMediaDTO {}

interface DownloadImageDTO {
  url: string;
  downloadFolder: string;
  fileName: string;
}

@Route('downloads')
@Tags('Downloads')
export class DownloadController extends Controller {
  /**
   * Download the background video of a movie, series or season
   */
  @Post('video')
  @Security('adminAuth')
  public async downloadVideo(@Body() body: DownloadVideoDTO): Promise<ApiResponse<null>> {
    await this.downloadThemeMedia('video', body);
    return ApiResponse.success(null, messages.success.download);
  }

  /**
   * Download the theme song of a movie, series or season
   */
  @Post('music')
  @Security('adminAuth')
  public async downloadMusic(@Body() body: DownloadMusicDTO): Promise<ApiResponse<null>> {
    await this.downloadThemeMedia('theme', body);
    return ApiResponse.success(null, messages.success.download);
  }

  private async downloadThemeMedia(kind: ThemeKind, { url, owner, id }: DownloadThemeMediaDTO) {
    const slot = await themeMediaSlot(owner, await findContent(owner, id), kind);
    if (!slot) throw new BadRequestException('The folder of this content is not available');

    // Chosen by the user: replaces the previous one
    await downloaderService.downloadThemeMedia(url, kind, slot, { overwrite: true, name: id });
  }

  /**
   * Download image file
   */
  @Post('image')
  @Security('adminAuth')
  public async downloadImage(@Body() body: DownloadImageDTO): Promise<ApiResponse<null>> {
    let { url, downloadFolder, fileName } = body;

    if (!isValidURL(url)) {
      throw new BadRequestException(messages.errors.validation.invalidData);
    }

    // If the file name doesn't have an extension, add .jpg
    if (!path.extname(fileName)) {
      fileName += '.jpg';
    }

    // Support both absolute paths (entity content folders) and LOCAL_DATA_PATH-relative paths
    const resolvedFolder = path.isAbsolute(downloadFolder)
      ? downloadFolder
      : fileSystemService.getExternalPath(downloadFolder);

    await downloadImage(url, path.join(resolvedFolder, fileName));

    return ApiResponse.success(null, messages.success.download);
  }
}
