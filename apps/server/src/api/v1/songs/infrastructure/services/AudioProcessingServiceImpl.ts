import type { Readable } from 'node:stream';
import { serveFileWithRanges } from '@/api/v1/shared/infrastructure/web/http/RangeFileResponder';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { fileSystemService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { executeFfmpeg } from '@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg';
import { NotFoundException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { messages } from '@/config/messages';
import { audioExtensions } from '@/utils/constants';
import type { AudioProcessingServicePort } from '../../application/ports/AudioProcessingServicePort';

export class AudioProcessingServiceImpl implements AudioProcessingServicePort {
  private cacheDir: string;

  private getAudioContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();

    const typeMap: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.opus': 'audio/ogg',
      '.ogg': 'audio/ogg',
      '.aac': 'audio/aac',
      '.wma': 'audio/x-ms-wma',
      '.webm': 'audio/webm',
      '.caf': 'audio/x-caf',
    };

    return typeMap[extension] ?? 'application/octet-stream';
  }

  constructor() {
    this.cacheDir = path.join(fileSystemService.resourcesPath, 'cache', 'audio');
    fileSystemService.createFolder(this.cacheDir);
  }

  /**
   * Determines the final audio file path that can be transmitted,
   * performing a conversion to MP3 if necessary.
   * @param originalPath The path to the original audio file.
   * @param isWeb Whether the client is a web platform that requires compatible codecs.
   * @returns The path to the audio file ready to be transmitted.
   */
  async getStreamableAudioPath(originalPath: string, isWeb: boolean): Promise<string> {
    if (!fileSystemService.existsSync(originalPath)) {
      throw new NotFoundException(messages.errors.notFound.file);
    }

    const fileExtension = path.extname(originalPath).toLowerCase();
    const isCompatible = audioExtensions.includes(fileExtension);

    // If not for web or compatible, just return the original path
    if (!isWeb || isCompatible) {
      return originalPath;
    }

    // Conversion and cache logic
    const originalPathHash = crypto.createHash('md5').update(originalPath).digest('hex');
    const cachedFilePath = path.join(this.cacheDir, `${originalPathHash}.mp3`);

    // Check if cached file already exists
    if (fileSystemService.existsSync(cachedFilePath)) {
      return cachedFilePath;
    }

    // Needs conversion
    try {
      await executeFfmpeg([
        '-i',
        originalPath,
        '-acodec',
        'libmp3lame',
        '-ab',
        '320k',
        cachedFilePath,
      ]);

      return cachedFilePath;
    } catch (_error) {
      // Clean failed file if created
      if (fileSystemService.existsSync(cachedFilePath)) fileSystemService.deleteFile(cachedFilePath);
      throw new Error(messages.errors.server.internal);
    }
  }

  /**
   * Sends a file to the client with support for streaming (HTTP 206 Partial Content).
   * @param filePath The path to the file that will be transmitted.
   */
  streamFile(filePath: string, req: Request, res: Response): void {
    const stat = fileSystemService.getFileStatsSync(filePath);
    if (!stat) {
      throw new NotFoundException(messages.errors.notFound.file);
    }
    serveFileWithRanges({
      req,
      res,
      size: stat.size,
      contentType: this.getAudioContentType(filePath),
      open: (range) => fileSystemService.createReadStream(filePath, range) as Readable,
    });
  }
}
