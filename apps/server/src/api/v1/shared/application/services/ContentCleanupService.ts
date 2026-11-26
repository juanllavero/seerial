import type { FileSystemServicePort } from '../ports/FileSystemServicePort';

/**
 * Centralizes local filesystem cleanup for all content types.
 * Only files of the application: the ones next to the content belong to the user and stay.
 */
export class ContentCleanupService {
  constructor(private readonly fs: FileSystemServicePort) { }

  getExternalPath(relativePath: string): string {
    return this.fs.getExternalPath(relativePath);
  }

  // Collection: delete the media/ folder under resources/collections/{id}/
  cleanCollectionMedia(id: string): void {
    this.fs.deleteFolder(this.getExternalPath(`resources/collections/${id}/media`));
  }

  // Album: poster image (still in resources)
  cleanAlbum(id: string): void {
    this.fs.deleteFolder(this.getExternalPath(`resources/img/posters/${id}`));
  }

  // Video: thumbnail images (frame and chapters)
  cleanVideo(id: string): void {
    this.fs.deleteFolder(this.getExternalPath(`resources/img/thumbnails/video/${id}`));
    this.fs.deleteFolder(this.getExternalPath(`resources/img/thumbnails/chapters/${id}`));
  }
}
