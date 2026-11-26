import { Body, Controller, FormField, Get, Path, Post, Route, Security, Tags, UploadedFile } from 'tsoa';
import { BadRequestException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import { ARTWORK_FIELDS, type ArtworkOwner } from '../../services/artwork/ArtworkService';
import { getLocalImages, setLocalImage, storedField } from '../../services/artwork/contentArtwork';

interface ArtworkAddressDTO {
  url: string;
}

/**
 * Local images of a content: one per field (cover, logo, background), kept next to it.
 * Setting one replaces the previous image and selects it.
 */
@Route('artwork')
@Tags('Artwork')
export class ArtworkController extends Controller {
  /** Paths of the local images of a content, by field */
  @Get('{owner}/{id}')
  @Security('adminAuth')
  public async getImages(
    @Path() owner: string,
    @Path() id: string,
  ): Promise<ApiResponse<{ [field: string]: string }>> {
    const images = await getLocalImages(this.toOwner(owner), id);
    return ApiResponse.success(images, messages.success.fetch);
  }

  /** Upload an image file for a field */
  @Post('{owner}/{id}/upload')
  @Security('adminAuth')
  public async upload(
    @Path() owner: string,
    @Path() id: string,
    @FormField() field: string,
    @UploadedFile() image: Express.Multer.File,
  ): Promise<ApiResponse<{ path: string }>> {
    const valid = this.toOwner(owner);
    const path = await setLocalImage(valid, id, this.toField(valid, field), image.buffer);
    return ApiResponse.success({ path }, messages.success.upload);
  }

  /** Download the image of an address for a field */
  @Post('{owner}/{id}/{field}')
  @Security('adminAuth')
  public async download(
    @Path() owner: string,
    @Path() id: string,
    @Path() field: string,
    @Body() body: ArtworkAddressDTO,
  ): Promise<ApiResponse<{ path: string }>> {
    const valid = this.toOwner(owner);
    if (!/^https?:\/\//.test(body.url)) throw new BadRequestException('Invalid image address');

    const path = await setLocalImage(valid, id, this.toField(valid, field), body.url);
    return ApiResponse.success({ path }, messages.success.upload);
  }

  private toOwner(owner: string): ArtworkOwner {
    if (!(owner in ARTWORK_FIELDS)) throw new BadRequestException(`Unknown content: ${owner}`);
    return owner as ArtworkOwner;
  }

  private toField(owner: ArtworkOwner, field: string): string {
    if (!(storedField(owner, field) in ARTWORK_FIELDS[owner])) {
      throw new BadRequestException(`${owner} has no ${field} image`);
    }
    return field;
  }
}
