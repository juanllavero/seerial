import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileSystemService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import {
  executeFfmpeg,
  executeFfprobe,
  readFfmpegLog,
} from '@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg';
import logger from '@/utils/logger';

/**
 * Background videos are played by a web view, with whatever file the user chose. Two things are
 * solved here, without touching that file: containers the web view cannot open (.m2ts, .mkv...)
 * are repackaged into a copy, and black side bars written into the picture (a 4:3 video saved as
 * 16:9) are reported so the player leaves them out.
 */

const backgroundVideoLogger = logger.child({ category: 'Background Video' });

const WEB_CONTAINERS = ['.mp4', '.m4v', '.mov', '.webm'];
/** Video codecs that can be copied as they are into the MP4 copy */
const COPYABLE_CODECS = ['h264', 'hevc', 'vp9', 'av1'];

export interface BackgroundVideo {
  path: string;
  /** Width / height of the picture between the side bars, only when it has them */
  aspect?: number;
}

interface VideoStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
}

const prepared = new Map<string, Promise<BackgroundVideo>>();

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 16);

/** Shape of the picture from the last `crop=w:h:x:y` of cropdetect, which covers every frame read */
export function pillarboxAspect(
  log: string,
  width: number,
  height: number,
  sampleAspect = 1,
): number | undefined {
  const crop = [...log.matchAll(/crop=(\d+):\d+:(\d+):\d+/g)].pop();
  if (!crop || !width || !height) return undefined;

  const [contentWidth, left] = [Number(crop[1]), Number(crop[2])];
  const right = width - contentWidth - left;
  // Bars are on both sides and alike: a dark side of the picture is not one
  if (left < width * 0.02 || Math.abs(left - right) > width * 0.01) return undefined;

  return (contentWidth * sampleAspect) / height;
}

async function repackage(file: string, stream: VideoStream, version: string): Promise<string> {
  const folder = fileSystemService.getExternalPath('resources/cache/background-videos');
  const source = sha1(file.toLowerCase());
  const destination = path.join(folder, `${source}-${version}.mp4`);
  if (fs.existsSync(destination)) return destination;

  fs.mkdirSync(folder, { recursive: true });
  // Copies of a previous version of the same file are of no use anymore
  for (const entry of fs.readdirSync(folder)) {
    if (entry.startsWith(`${source}-`)) fs.rmSync(path.join(folder, entry), { force: true });
  }

  const temporary = path.join(folder, `${source}-${version}.tmp.mp4`);
  const videoArgs = COPYABLE_CODECS.includes(stream.codec_name ?? '')
    ? ['-c:v', 'copy', ...(stream.codec_name === 'hevc' ? ['-tag:v', 'hvc1'] : [])]
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];

  await executeFfmpeg([
    '-y',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    ...videoArgs,
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    temporary,
  ]);
  fs.renameSync(temporary, destination);

  return destination;
}

async function prepare(file: string, version: string): Promise<BackgroundVideo> {
  const probe = await executeFfprobe(file);
  const stream = (probe.streams as VideoStream[]).find((s) => s.codec_type === 'video');
  if (!stream) return { path: file };

  const playable = WEB_CONTAINERS.includes(path.extname(file).toLowerCase())
    ? file
    : await repackage(file, stream, version);

  // Keyframes are enough to find the bars, and take a fraction of the time
  const log = await readFfmpegLog(
    [
      '-hide_banner',
      '-nostdin',
      '-skip_frame',
      'nokey',
      '-i',
      playable,
      '-an',
      '-vf',
      // A fraction: an absolute limit misses the black of 10 bit videos
      'cropdetect=limit=0.1:round=2',
      '-f',
      'null',
      '-',
    ],
    30000,
  );

  const [numerator, denominator] = (stream.sample_aspect_ratio ?? '').split(':').map(Number);
  const aspect = pillarboxAspect(
    log,
    stream.width ?? 0,
    stream.height ?? 0,
    numerator && denominator ? numerator / denominator : 1,
  );

  return { path: playable, aspect };
}

/** What has to be streamed for a background video. The file itself when it cannot be analysed */
export async function prepareBackgroundVideo(file: string): Promise<BackgroundVideo> {
  let version: string;
  try {
    const { size, mtimeMs } = fs.statSync(file);
    version = sha1(`${size}-${mtimeMs}`);
  } catch {
    return { path: file };
  }

  const key = `${file}|${version}`;
  let result = prepared.get(key);
  // The copy may have been deleted since
  if (result && !fs.existsSync((await result).path)) result = undefined;

  if (!result) {
    result = prepare(file, version).catch((error) => {
      backgroundVideoLogger.error(error, `Could not prepare ${file}`);
      prepared.delete(key);
      return { path: file };
    });
    prepared.set(key, result);
  }

  return result;
}
