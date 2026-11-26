import type { AudioTrack, SubtitleTrack, VideoTrack } from '@seerial/domain';

interface FfmpegStream {
  index?: number;
  codec_name?: string;
  codec_long_name?: string;
  tags?: Record<string, string>;
  avg_frame_rate?: string;
  width?: string;
  height?: string;
  codedWidth?: string;
  codedHeight?: string;
  chroma_location?: string;
  color_space?: string;
  color_transfer?: string;
  display_aspect_ratio?: string;
  profile?: string;
  refs?: string;
  color_range?: string;
  channels?: number;
  channel_layout?: string;
  bits_per_raw_sample?: string;
  sample_rate?: string;
  language?: string;
  disposition?: { forced?: number };
}

function mapAudioProfile(profile?: string): string {
  // Also matches 'DTS-HD MA + DTS:X'
  if (profile?.startsWith('DTS-HD MA')) return 'ma';
  if (profile === 'LC') return 'lc';
  return '';
}

function getAudioCodecDisplayName(stream: FfmpegStream): string {
  if (stream.profile?.startsWith('DTS-HD MA')) return 'DTS-HD MA';
  return stream.codec_name?.toUpperCase() || '';
}

/**
 * HDR flavour of a video stream.
 * The transfer function is what really tells HDR apart (PQ = HDR10, HLG); the BT.2020 color space
 * alone is kept as a fallback for files whose transfer characteristic is not reported.
 */
export function detectHdrFormat(colorTransfer?: string, colorSpace?: string): string {
  if (colorTransfer === 'smpte2084') return 'HDR10';
  if (colorTransfer === 'arib-std-b67') return 'HLG';
  if (!colorTransfer && colorSpace === 'bt2020nc') return 'HDR10';
  return '';
}

// Process video data
export function processVideoData(stream: FfmpegStream): VideoTrack {
  const videoTrack: VideoTrack = {
    id: stream.index ?? 0,
    codec: stream.codec_name?.toUpperCase() || '',
    displayTitle: '',
    selected: false,
    codecExt: '',
    bitrate: '',
    framerate: '',
    codedHeight: '',
    codedWidth: '',
    chromaLocation: '',
    colorSpace: '',
    aspectRatio: '',
    profile: '',
    refFrames: '',
    colorRange: '',
    colorTransfer: '',
    hdrFormat: '',
  };

  let resolution: string = '';
  let hdr: string = '';

  if (stream.codec_long_name) videoTrack.codecExt = stream.codec_long_name;

  if (stream.tags?.BPS)
    videoTrack.bitrate = Math.round(parseFloat(stream.tags.BPS) / 10 ** 3).toString();

  if (stream.avg_frame_rate) {
    const [numerator, denominator] = stream.avg_frame_rate.split('/').map(Number);
    if (denominator && denominator !== 0) {
      videoTrack.framerate = `${(numerator / denominator).toFixed(3)} fps`;
    } else {
      videoTrack.framerate = `${numerator.toFixed(3)} fps`;
    }
  }

  videoTrack.codedWidth = stream.width || stream.codedWidth || '';
  videoTrack.codedHeight = stream.height || stream.codedHeight || '';

  resolution = formatResolution(videoTrack.codedWidth, videoTrack.codedHeight);

  if (stream.chroma_location) videoTrack.chromaLocation = stream.chroma_location;

  if (stream.color_transfer) videoTrack.colorTransfer = stream.color_transfer;

  if (stream.color_space) videoTrack.colorSpace = stream.color_space;

  hdr = detectHdrFormat(stream.color_transfer, stream.color_space);
  videoTrack.hdrFormat = hdr;

  if (stream.display_aspect_ratio) videoTrack.aspectRatio = stream.display_aspect_ratio;

  if (stream.profile) videoTrack.profile = stream.profile;

  if (stream.refs) videoTrack.refFrames = stream.refs;

  if (stream.color_range) videoTrack.colorRange = stream.color_range;

  // Rellenar otros datos
  videoTrack.displayTitle = `${resolution} ${hdr} (${videoTrack.codec} ${videoTrack.profile})`;

  return videoTrack;
}

// Process audio data
export function processAudioData(stream: FfmpegStream): AudioTrack {
  const audioTrack: AudioTrack = {
    id: stream.index ?? 0,
    codec: stream.codec_name?.toUpperCase() || '',
    displayTitle: '',
    language: '',
    languageTag: '',
    selected: false,
    codecExt: '',
    channels: '',
    channelLayout: '',
    bitrate: '',
    bitDepth: '',
    profile: '',
    samplingRate: '',
  };

  if (stream.codec_long_name) audioTrack.codecExt = stream.codec_long_name;

  if (stream.channels) audioTrack.channels = formatAudioChannels(stream.channels);

  if (stream.channel_layout) audioTrack.channelLayout = stream.channel_layout;

  if (stream.tags?.BPS)
    audioTrack.bitrate = Math.round(parseFloat(stream.tags.BPS) / 10 ** 3).toString();

  if (stream.tags?.language) {
    audioTrack.languageTag = stream.tags.language;

    const languageNames = new Intl.DisplayNames(['en'], {
      type: 'language',
      languageDisplay: 'standard',
    });
    const languageName = languageNames.of(audioTrack.languageTag);

    if (languageName) audioTrack.language = languageName;
  }

  if (stream.bits_per_raw_sample && stream.bits_per_raw_sample !== 'N/A') {
    audioTrack.bitDepth = stream.bits_per_raw_sample;
  }

  audioTrack.profile = mapAudioProfile(stream.profile);

  if (stream.sample_rate) audioTrack.samplingRate = `${stream.sample_rate} hz`;

  const codecDisplayName = getAudioCodecDisplayName(stream);

  audioTrack.displayTitle = `(${codecDisplayName} ${audioTrack.channels})`;

  return audioTrack;
}

/**
 * Reads, from the stream list `ffmpeg -i` prints (ffmpeg 6.1+), the indexes of the audio streams
 * whose codec profile reports Dolby Atmos, e.g.
 * `Stream #0:2(eng): Audio: eac3 (Dolby Digital Plus + Dolby Atmos), 48000 Hz, 5.1(side)`.
 */
export function parseDolbyAtmosStreamIndexes(summary: string): Set<number> {
  const indexes = new Set<number>();

  for (const line of summary.split(/\r?\n/)) {
    const match = /Stream #\d+:(\d+)[^:]*: Audio: (.*)/.exec(line);
    if (match && match[2].toLowerCase().includes('dolby atmos')) {
      indexes.add(Number(match[1]));
    }
  }

  return indexes;
}

/**
 * Reads, from the `ffmpeg -i` stream list, the indexes of the audio streams that carry DTS:X, e.g.
 * `Stream #0:1: Audio: dts (dca) (DTS-HD MA + DTS:X), 48000 Hz, 7.1`.
 */
export function parseDtsXStreamIndexes(summary: string): Set<number> {
  const indexes = new Set<number>();

  for (const line of summary.split(/\r?\n/)) {
    const match = /Stream #\d+:(\d+)[^:]*: Audio: (.*)/.exec(line);
    if (match && /dts:x/i.test(match[2])) indexes.add(Number(match[1]));
  }

  return indexes;
}

/**
 * Reads the indexes of the video streams that carry a Dolby Vision configuration record. ffmpeg
 * prints it under the stream, as side data:
 * `Side data:` / `DOVI configuration record: version: 1.0, profile: 8, ...`.
 */
export function parseDolbyVisionStreamIndexes(summary: string): Set<number> {
  const indexes = new Set<number>();
  let currentStream: number | undefined;

  for (const line of summary.split(/\r?\n/)) {
    const stream = /Stream #\d+:(\d+)/.exec(line);
    if (stream) {
      currentStream = Number(stream[1]);
    } else if (currentStream !== undefined && /DOVI configuration record/i.test(line)) {
      indexes.add(currentStream);
    }
  }

  return indexes;
}

/** Whether `ffprobe -show_frames` output reports HDR10+ (SMPTE 2094-40) dynamic metadata. */
export function hasHdr10PlusMetadata(frameProbeJson: string): boolean {
  return /SMPTE2094-40|HDR10\+/i.test(frameProbeJson);
}

// Process subtitle data
export function processSubtitleData(stream: FfmpegStream): SubtitleTrack {
  const subtitleTrack: SubtitleTrack = {
    id: stream.index ?? 0,
    codec: stream.codec_name?.toUpperCase() || '',
    displayTitle: '',
    language: '',
    languageTag: '',
    selected: false,
    codecExt: '',
    title: '',
    forced: stream.disposition?.forced === 1,
  };

  let codecDisplayName: string = '';
  codecDisplayName = stream.codec_name?.toUpperCase() || '';

  if (codecDisplayName === 'HDMV_PGS_SUBTITLE') codecDisplayName = 'PGS';
  else if (codecDisplayName === 'SUBRIP') codecDisplayName = 'SRT';

  if (stream.codec_long_name) {
    subtitleTrack.codecExt = stream.codec_long_name;
  }

  if (stream.tags?.language) {
    subtitleTrack.languageTag = stream.tags.language;
    subtitleTrack.language = stream.language || '';
  }

  if (stream.tags?.title) {
    subtitleTrack.title = stream.tags.title;
  }

  subtitleTrack.displayTitle = `${stream.disposition?.forced === 1 ? '(Forced)' : ''}(${codecDisplayName})`;

  return subtitleTrack;
}

// Format video resolution
export function formatResolution(width: string, height: string): string {
  const widthNum = parseInt(width, 10); // Convertir a número
  switch (widthNum) {
    case 7680:
      return '8K';
    case 3840:
      return '4K';
    case 2560:
      return 'QHD';
    case 1920:
      return '1080p';
    case 1280:
      return '720p';
    case 854:
      return '480p';
    case 640:
      return '360p';
    default:
      return `${height}p`;
  }
}

// Format audio channels
export function formatAudioChannels(channels: number): string {
  switch (channels) {
    case 1:
      return 'MONO';
    case 2:
      return 'STEREO';
    case 6:
      return '5.1';
    case 8:
      return '7.1';
    default:
      return `${channels} channels`;
  }
}

export function convertTime(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s
    .toString()
    .padStart(2, '0')}`;
}

export function formatTime(time: number): string {
  const h = Math.floor(time / 3600);
  const m = Math.floor((time % 3600) / 60);
  const s = Math.floor(time % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m
      .toString()
      .padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
