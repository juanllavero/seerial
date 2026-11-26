import crypto from 'node:crypto';
import os from 'node:os';
import nodePath from 'node:path';
import type { Chapter } from '@seerial/domain';
import type { Response as ExpressResponse } from 'express';
import { fileSystemService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import {
    executeFfmpeg,
    executeFfmpegPipeToStream,
} from '@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg';
import {
    BadRequestException,
    NotFoundException,
} from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { messages } from '@/config/messages';
import logger from '@/utils/logger';
import type { VideoExtractionServicePort } from '../../application/ports/VideoExtractionServicePort';

const videoExtractionLogger = logger.child({ category: 'Video Extraction' });

const THUMBNAIL_CONCURRENCY = 2;
/** Seconds past the chapter start, to skip the black frames and fades that often open it. */
const THUMBNAIL_OFFSET_SECONDS = 1;
/** Generations in progress by video, so simultaneous requests share the work. */
const pendingThumbnails = new Map<string, Promise<void>>();

interface ThumbnailJob {
  time: number;
  outputPath: string;
}

async function extractThumbnail(videoPath: string, { time, outputPath }: ThumbnailJob) {
  const run = (seek: number, decoderArgs: string[]) =>
    executeFfmpeg(
      [
        '-nostdin',
        '-threads',
        '1',
        ...decoderArgs,
        '-ss',
        String(seek),
        '-i',
        videoPath,
        '-an',
        '-sn',
        '-dn',
        '-frames:v',
        '1',
        '-vf',
        'scale=480:-2',
        '-y',
        outputPath,
      ],
      { lowPriority: true },
    );

  // Decoding only keyframes takes one frame per chapter instead of everything since the
  // previous keyframe: several times faster, above all on 4K
  await run(time + THUMBNAIL_OFFSET_SECONDS, ['-skip_frame', 'nokey']);
  // No keyframe left after that point (very last chapter): take the exact frame
  if (!fileSystemService.existsSync(outputPath)) await run(time, []);
}

async function extractThumbnails(videoPath: string, jobs: ThumbnailJob[]) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await extractThumbnail(videoPath, job);
      } catch (err) {
        videoExtractionLogger.error(
          { err, outputPath: job.outputPath },
          'Failed to generate chapter thumbnail',
        );
      }
    }
  };
  await Promise.all(Array.from({ length: THUMBNAIL_CONCURRENCY }, worker));
}

export class VideoExtractionServiceImpl implements VideoExtractionServicePort {
  /**
   * Stores a frame of the video as its thumbnail, for the videos without images in TMDb.
   * Returns the relative resource path, empty if it failed.
   */
  public async generateVideoThumbnail(
    videoId: string,
    videoPath: string,
    time: number,
  ): Promise<string> {
    const relativePath = `resources/img/thumbnails/video/${videoId}/frame.jpg`;
    const outputPath = fileSystemService.getExternalPath(relativePath);
    fileSystemService.createFolder(nodePath.dirname(outputPath));

    try {
      await extractThumbnail(videoPath, { time, outputPath });
    } catch (err) {
      videoExtractionLogger.error({ err, outputPath }, 'Failed to generate video thumbnail');
    }

    return fileSystemService.existsSync(outputPath) ? relativePath : '';
  }

  /**
   * Extract video thumbnail and stream it to response
   */
  public async streamVideoThumbnail(
    videoUrl: string,
    time: string,
    res: ExpressResponse,
  ): Promise<void> {
    const timeParam = time || '10';

    if (!videoUrl) {
      throw new BadRequestException(messages.errors.validation.notEnoughParams);
    }

    const videoSrc = videoUrl.startsWith('resources')
      ? fileSystemService.getExternalPath(videoUrl)
      : videoUrl;

    res.setHeader('Content-Type', 'image/jpeg');

    const args = ['-i', videoSrc, '-ss', timeParam, '-frames:v', '1', '-f', 'mjpeg'];

    executeFfmpegPipeToStream(
      args,
      res,
      (err) => {
        videoExtractionLogger.error(err, 'FFMPEG error generating thumbnail');
        if (!res.headersSent) {
          res.status(500).send(messages.errors.server.internal);
        }
      },
      (code) => {
        if (code !== 0) {
          videoExtractionLogger.error({ exitCode: code }, 'FFmpeg error: process exited');
          if (!res.headersSent) {
            res.status(500).send(messages.errors.server.internal);
          }
        }
      },
    );
  }

  /**
   * Extract subtitle track from video and stream it to response
   */
  public async streamVideoSubtitles(
    videoPath: string,
    trackId: number,
    startTime: number,
    res: ExpressResponse,
  ): Promise<void> {
    const trackIdNum = trackId;
    const startTimeNum = startTime || 0;

    if (Number.isNaN(trackIdNum)) {
      throw new BadRequestException(messages.errors.validation.invalidData);
    }

    if (!fileSystemService.existsSync(videoPath)) {
      throw new NotFoundException(messages.errors.notFound.file);
    }

    const hash = crypto
      .createHash('md5')
      .update(videoPath + trackIdNum + startTimeNum)
      .digest('hex');
    const cacheDir = fileSystemService.join(os.tmpdir(), 'video_subs_cache');
    fileSystemService.createFolder(cacheDir);
    const cachedFile = fileSystemService.join(cacheDir, `${hash}.vtt`);

    res.setHeader('Content-Type', 'text/vtt');

    if (await fileSystemService.exists(cachedFile)) {
      fileSystemService.createReadStream(cachedFile).pipe(res);
      return;
    }

    const args: string[] = [];
    if (startTimeNum > 0) {
      args.push('-ss', startTimeNum.toString());
    }
    args.push('-i', videoPath, '-map', `0:s:${trackIdNum}`, '-f', 'webvtt', cachedFile);

    try {
      await executeFfmpeg(args);
      fileSystemService.createReadStream(cachedFile).pipe(res);
    } catch (error) {
      videoExtractionLogger.error(error, 'FFMPEG error generating subtitles');
      if (!res.headersSent) {
        res.status(500).send(messages.errors.server.internal);
      }
    }
  }

  /**
   * Generate chapter thumbnails for a video and store them on disk.
   * Returns chapters with thumbnailSrc populated (relative resource path, empty if it failed).
   * Only the missing thumbnails are generated.
   */
  public async generateChapterThumbnails(
    videoId: string,
    videoPath: string,
    chapters: Chapter[],
  ): Promise<Chapter[]> {
    if (!chapters.length) return chapters;

    // Sent to clients as a URL parameter: always with forward slashes, also on Windows
    const relativeBase = `resources/img/thumbnails/chapters/${videoId}`;
    const thumbnailsDir = fileSystemService.getExternalPath(relativeBase);
    const outputPaths = chapters.map((_, i) => nodePath.join(thumbnailsDir, `chapter_${i}.jpg`));

    let pending = pendingThumbnails.get(videoId);
    if (!pending) {
      const jobs = chapters
        .map((chapter, i) => ({ time: Number(chapter.time) || 0, outputPath: outputPaths[i] }))
        .filter((job) => !fileSystemService.existsSync(job.outputPath));

      if (jobs.length) {
        fileSystemService.createFolder(thumbnailsDir);
        pending = extractThumbnails(videoPath, jobs).finally(() =>
          pendingThumbnails.delete(videoId),
        );
        pendingThumbnails.set(videoId, pending);
      }
    }
    await pending;

    return chapters.map((chapter, i) => ({
      ...chapter,
      thumbnailSrc: fileSystemService.existsSync(outputPaths[i])
        ? `${relativeBase}/chapter_${i}.jpg`
        : '',
    }));
  }
}
