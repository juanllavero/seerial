import path from 'node:path';
import type {
  AudioTrack,
  Chapter as ChapterData,
  MediaInfo,
  MediaInfoData,
  SubtitleTrack,
  VideoTrack,
} from '@seerial/domain';
import logger from '@/utils/logger';
import { executeFfprobe, executeFfprobeRaw, readFfmpegStreamSummary } from './nativeFfmpeg';
import {
  formatTime,
  hasHdr10PlusMetadata,
  parseDolbyAtmosStreamIndexes,
  parseDolbyVisionStreamIndexes,
  parseDtsXStreamIndexes,
  processAudioData,
  processSubtitleData,
  processVideoData,
} from './utils/ffmpegUtils';

/**
 * Retrieves the duration of a video/audio file.
 * @param mediaFile - The path to the media file to probe for duration.
 * @returns The duration or 0.
 */
export async function getOnlyRuntime(mediaFile: string): Promise<number> {
  if (!mediaFile || typeof mediaFile !== 'string') {
    logger.error('getOnlyRuntime: Invalid media file path provided.');
    return 0;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = (await executeFfprobe(mediaFile)) as {
        format?: { duration?: number | string };
      };
      const raw = data?.format?.duration;
      const duration = Number(raw);

      if (!Number.isNaN(duration) && duration > 0) {
        return duration / 60;
      }

      return 0;
    } catch (err) {
      logger.error({ err, mediaFile, attempt }, 'getOnlyRuntime: ffprobe failed');
      if (attempt === 2) return 0;
    }
  }

  return 0;
}

export async function getMediaInfo(
  videoPath: string,
  extractChapters: boolean = true,
): Promise<MediaInfoData | undefined> {
  if (!videoPath || videoPath === '') {
    logger.error({
      message: 'Video file does not exist or path is empty',
      videoPath,
    });
    return undefined;
  }

  try {
    const data = (await executeFfprobe(videoPath)) as {
      format: {
        size?: number;
        bit_rate?: number;
        duration?: number;
      };
      streams: Array<{
        codec_type?: string;
        [key: string]: unknown;
      }>;
    };
    const format = data.format;
    const streams = data.streams;

    // Configura la información general del medio
    let fileSize = format.size ? format.size : 0;
    let sizeSufix = ' GB';
    fileSize = fileSize / 1024 ** 3;

    if (fileSize < 1) {
      fileSize = fileSize * 1024 ** 1;
      sizeSufix = ' MB';
    }

    const mediaInfo: MediaInfo = {
      file: path.basename(videoPath),
      location: videoPath,
      bitrate: format.bit_rate ? `${(format.bit_rate / 10 ** 3).toFixed(2)} kbps` : '0',
      duration: format.duration ? formatTime(format.duration) : '0',
      size: fileSize.toFixed(2) + sizeSufix,
      container: path.extname(videoPath).replace('.', '').toUpperCase(),
    };

    // Get the duration
    const duration = format.duration ? format.duration / 60 : 0;

    // Limpia las listas anteriores de pistas
    const videoTracks: VideoTrack[] = [];
    const audioTracks: AudioTrack[] = [];
    const subtitleTracks: SubtitleTrack[] = [];

    for (const stream of streams) {
      const codecType = stream.codec_type;
      if (codecType === 'video') {
        videoTracks.push(processVideoData(stream as Parameters<typeof processVideoData>[0]));
      } else if (codecType === 'audio') {
        audioTracks.push(processAudioData(stream as Parameters<typeof processAudioData>[0]));
      } else if (codecType === 'subtitle') {
        subtitleTracks.push(
          processSubtitleData(stream as Parameters<typeof processSubtitleData>[0]),
        );
      }
    }

    await markFormatTracks(videoPath, videoTracks, audioTracks);

    const chapters = extractChapters ? await getChapters(videoPath) : [];

    return {
      mediaInfo,
      videoTracks,
      audioTracks,
      subtitleTracks,
      chapters,
      duration,
    };
  } catch (err) {
    logger.error(err, 'Failed to get media info');
    throw err; // Re-lanzar para manejo externo si es necesario
  }
}

// Audio codecs that can carry Dolby Atmos (E-AC-3 JOC and TrueHD)
const ATMOS_CAPABLE_CODECS = ['EAC3', 'TRUEHD'];

/**
 * Sets the format flags the logos depend on. ffprobe 4 cannot tell Atmos or DTS:X apart and does
 * not report Dolby Vision, so the ffmpeg 6.1 stream summary is read once; HDR10+ lives in the frames
 * and is only looked up on the HDR (PQ) picture.
 */
async function markFormatTracks(
  videoPath: string,
  videoTracks: VideoTrack[],
  audioTracks: AudioTrack[],
): Promise<void> {
  for (const track of audioTracks) {
    track.hasDolbyAtmos = false;
    track.hasDtsX = false;
  }
  for (const track of videoTracks) {
    track.hasDolbyVision = false;
    track.hasHdr10Plus = false;
  }

  try {
    const summary = await readFfmpegStreamSummary(videoPath);
    const atmosStreams = parseDolbyAtmosStreamIndexes(summary);
    const dtsXStreams = parseDtsXStreamIndexes(summary);
    const dolbyVisionStreams = parseDolbyVisionStreamIndexes(summary);
    for (const track of audioTracks) {
      track.hasDolbyAtmos = ATMOS_CAPABLE_CODECS.includes(track.codec) && atmosStreams.has(track.id);
      track.hasDtsX = track.codec === 'DTS' && dtsXStreams.has(track.id);
    }
    for (const track of videoTracks) {
      track.hasDolbyVision = dolbyVisionStreams.has(track.id);
    }
  } catch (err) {
    logger.warn({ err, videoPath }, 'Failed to read the audio/video formats of the file');
  }

  const main = videoTracks.find((track) => track.colorTransfer === 'smpte2084');
  if (!main) return;

  try {
    const frames = await executeFfprobeRaw(
      [
        '-v',
        'error',
        '-select_streams',
        `0:${main.id}`,
        '-read_intervals',
        '%+#2',
        '-show_entries',
        'frame=side_data_list',
        '-of',
        'json',
        '-i',
        videoPath,
      ],
      20000,
    );
    main.hasHdr10Plus = hasHdr10PlusMetadata(frames);
  } catch (err) {
    logger.warn({ err, videoPath }, 'Failed to check HDR10+ in video');
  }
}

export async function getChapters(videoPath: string): Promise<ChapterData[]> {
  const chaptersArray: ChapterData[] = [];

  try {
    const stdout = await executeFfprobeRaw([
      '-v',
      'error',
      '-show_entries',
      'chapter',
      '-of',
      'json',
      '-i',
      videoPath,
    ]);

    const metadata = JSON.parse(stdout);
    const chapters = metadata.chapters || [];
    if (chapters.length > 0) {
      for (const chapter of chapters) {
        const chapterData: ChapterData = {
          title: chapter.title || 'Sin título',
          time: chapter.start_time || 0,
          displayTime: formatTime(chapter.start_time || 0),
          thumbnailSrc: '',
        };
        chaptersArray.push(chapterData);
      }
      logger.info({
        message: 'Chapters extracted',
        chapterCount: chaptersArray.length,
      });
    } else {
      logger.info({
        message: 'No chapters found in the file',
        file: videoPath,
      });
    }
  } catch (error: unknown) {
    logger.error({
      err: error,
      message: 'Error getting chapters',
      file: videoPath,
    });
  }

  return chaptersArray;
}
