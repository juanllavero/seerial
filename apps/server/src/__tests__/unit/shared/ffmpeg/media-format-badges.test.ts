import {
  type AudioTrack,
  getMainVideoTrack,
  getMediaFormatBadges,
  isHdrVideoTrack,
  needsMediaFormatAnalysis,
  type VideoTrack,
} from '@seerial/domain';
import {
  detectHdrFormat,
  hasHdr10PlusMetadata,
  parseDolbyAtmosStreamIndexes,
  parseDolbyVisionStreamIndexes,
  parseDtsXStreamIndexes,
  processAudioData,
  processVideoData,
} from '@/api/v1/shared/infrastructure/adapters/ffmpeg/utils/ffmpegUtils';

const video = (overrides: Partial<VideoTrack> = {}): VideoTrack => ({
  displayTitle: '4K (HEVC Main 10)',
  id: 0,
  selected: false,
  codec: 'HEVC',
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
  ...overrides,
});

const audio = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  displayTitle: '',
  id: 1,
  language: '',
  languageTag: '',
  selected: false,
  codec: 'AC3',
  codecExt: '',
  channels: '',
  channelLayout: '',
  bitrate: '',
  bitDepth: '',
  profile: '',
  samplingRate: '',
  ...overrides,
});

describe('ffprobe stream processing for format logos', () => {
  it('detects HDR10 by PQ transfer, HLG, and falls back to BT.2020 when no transfer is reported', () => {
    expect(detectHdrFormat('smpte2084', 'bt2020nc')).toBe('HDR10');
    expect(detectHdrFormat('arib-std-b67', 'bt2020nc')).toBe('HLG');
    expect(detectHdrFormat(undefined, 'bt2020nc')).toBe('HDR10');
    expect(detectHdrFormat('bt709', 'bt709')).toBe('');
    // BT.2020 with an SDR transfer is wide gamut, not HDR
    expect(detectHdrFormat('bt709', 'bt2020nc')).toBe('');
  });

  it('stores the HDR format and transfer on the video track', () => {
    const track = processVideoData({
      index: 0,
      codec_name: 'hevc',
      width: '3840',
      height: '2160',
      color_space: 'bt2020nc',
      color_transfer: 'smpte2084',
    });

    expect(track.hdrFormat).toBe('HDR10');
    expect(track.colorTransfer).toBe('smpte2084');
    expect(track.displayTitle).toContain('HDR10');
  });

  it('maps DTS-HD MA profiles, including DTS:X, to the master audio profile', () => {
    expect(processAudioData({ index: 1, codec_name: 'dts', profile: 'DTS-HD MA' }).profile).toBe('ma');
    expect(processAudioData({ index: 1, codec_name: 'dts', profile: 'DTS-HD MA + DTS:X' }).profile).toBe('ma');
    expect(processAudioData({ index: 1, codec_name: 'dts', profile: 'DTS' }).profile).toBe('');
  });

  it('finds the audio streams that carry Dolby Atmos in the ffmpeg summary', () => {
    const summary = [
      'Input #0, matroska,webm, from "movie.mkv":',
      '  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160',
      '  Stream #0:1(eng): Audio: truehd (Dolby TrueHD + Dolby Atmos), 48000 Hz, 7.1, s32 (24 bit) (default)',
      '  Stream #0:2(eng): Audio: eac3 (Dolby Digital Plus), 48000 Hz, 5.1(side), fltp, 640 kb/s',
      '  Stream #0:3(spa): Audio: eac3 (Dolby Digital Plus + Dolby Atmos), 48000 Hz, 5.1(side), fltp',
      '  Stream #0:4(eng): Subtitle: subrip (srt)',
    ].join('\r\n');

    expect([...parseDolbyAtmosStreamIndexes(summary)]).toEqual([1, 3]);
    expect(parseDolbyAtmosStreamIndexes('no streams here').size).toBe(0);
  });
});

describe('getMediaFormatBadges', () => {
  it('shows nothing for an SDR movie with an audio format that has no logo', () => {
    expect(getMediaFormatBadges([video()], audio({ codec: 'AAC', profile: 'lc' }))).toEqual([]);
    expect(getMediaFormatBadges([video()], null)).toEqual([]);
  });

  it('shows Dolby Digital for AC-3 and Dolby Digital Plus for E-AC-3 without Atmos', () => {
    expect(getMediaFormatBadges([video()], audio({ codec: 'AC3' }))).toEqual(['dolby-digital']);
    expect(getMediaFormatBadges([video()], audio({ codec: 'EAC3', hasDolbyAtmos: false }))).toEqual(['dolby-digital-plus']);
    expect(getMediaFormatBadges([video()], audio({ codec: 'EAC3', hasDolbyAtmos: true }))).toEqual(['dolby-atmos']);
    // Not analysed for Atmos yet (older data): nothing is shown rather than a wrong logo
    expect(getMediaFormatBadges([video()], audio({ codec: 'EAC3' }))).toEqual([]);
  });

  it('shows HDR from the picture regardless of the audio (HDR10, HDR10+ and HLG alike)', () => {
    const aac = audio({ codec: 'AAC', profile: 'lc' });
    expect(getMediaFormatBadges([video({ hdrFormat: 'HDR10' })], aac)).toEqual(['hdr']);
    expect(getMediaFormatBadges([video({ hdrFormat: 'HLG' })], null)).toEqual(['hdr']);
  });

  it('shows DTS-HD for the selected DTS-HD MA track only', () => {
    const dts = audio({ codec: 'DTS', profile: 'ma' });
    expect(getMediaFormatBadges([video()], dts)).toEqual(['dts-hd']);
    // Plain DTS core has its own logo
    expect(getMediaFormatBadges([video()], audio({ codec: 'DTS', profile: '' }))).toEqual(['dts']);
    // DTS:X wins over DTS-HD MA
    expect(
      getMediaFormatBadges([video()], audio({ codec: 'DTS', profile: 'ma', hasDtsX: true })),
    ).toEqual(['dtsx']);
  });

  it('shows Dolby Atmos only when the selected track carries it', () => {
    const atmos = audio({ codec: 'TRUEHD', hasDolbyAtmos: true });
    const plain = audio({ codec: 'TRUEHD', hasDolbyAtmos: false });
    expect(getMediaFormatBadges([video()], atmos)).toEqual(['dolby-atmos']);
    // TrueHD without Atmos has no logo
    expect(getMediaFormatBadges([video()], plain)).toEqual([]);
  });

  it('picks one picture logo: Dolby Vision, then HDR10+, then HDR', () => {
    const hdr = { hdrFormat: 'HDR10' };
    expect(getMediaFormatBadges([video({ ...hdr, hasDolbyVision: true, hasHdr10Plus: true })], null)).toEqual(['dolby-vision']);
    expect(getMediaFormatBadges([video({ ...hdr, hasHdr10Plus: true })], null)).toEqual(['hdr10plus']);
    expect(getMediaFormatBadges([video({ ...hdr })], null)).toEqual(['hdr']);
  });

  it('shows 4K or HD from the picture size, nothing for standard definition', () => {
    const size = (codedWidth: string, codedHeight: string) =>
      getMediaFormatBadges([video({ codedWidth, codedHeight })], null);
    expect(size('3840', '2160')).toEqual(['4k']);
    expect(size('3840', '1600')).toEqual(['4k']);
    expect(size('1920', '1080')).toEqual(['hd']);
    expect(size('1920', '800')).toEqual(['hd']);
    expect(size('1280', '720')).toEqual(['hd']);
    expect(size('704', '480')).toEqual([]);
    expect(size('', '')).toEqual([]);
  });

  it('orders the logos: resolution, picture, audio', () => {
    const picture = video({ codedWidth: '3840', codedHeight: '2160', hdrFormat: 'HDR10', hasDolbyVision: true });
    expect(
      getMediaFormatBadges([picture], audio({ codec: 'TRUEHD', hasDolbyAtmos: true })),
    ).toEqual(['4k', 'dolby-vision', 'dolby-atmos']);
  });

  it('combines HDR with an audio logo, in the order HDR, DTS-HD, Dolby Atmos', () => {
    const hdr = [video({ hdrFormat: 'HDR10' })];
    expect(getMediaFormatBadges(hdr, audio({ codec: 'EAC3', hasDolbyAtmos: true }))).toEqual([
      'hdr',
      'dolby-atmos',
    ]);
    expect(getMediaFormatBadges(hdr, audio({ codec: 'DTS', profile: 'ma' }))).toEqual([
      'hdr',
      'dts-hd',
    ]);
    expect(getMediaFormatBadges(hdr, audio({ codec: 'AC3' }))).toEqual(['hdr', 'dolby-digital']);
  });

  it('finds DTS:X and Dolby Vision in the ffmpeg summary, and HDR10+ in the frames', () => {
    const summary = [
      '  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160',
      '  Side data:',
      '    DOVI configuration record: version: 1.0, profile: 8, level: 6, rpu flag: 1',
      '  Stream #0:1(eng): Audio: dts (dca) (DTS-HD MA + DTS:X), 48000 Hz, 7.1',
      '  Stream #0:2(eng): Audio: dts (dca) (DTS-HD MA), 48000 Hz, 5.1(side)',
      '  Stream #0:3: Video: mjpeg (Baseline), 600x754 (attached pic)',
    ].join('\n');
    expect([...parseDolbyVisionStreamIndexes(summary)]).toEqual([0]);
    expect([...parseDtsXStreamIndexes(summary)]).toEqual([1]);
    expect(parseDolbyVisionStreamIndexes('Stream #0:0: Video: h264').size).toBe(0);
    expect(hasHdr10PlusMetadata('{"side_data_type": "HDR Dynamic Metadata SMPTE2094-40 (HDR10+)"}')).toBe(true);
    expect(hasHdr10PlusMetadata('{"frames":[{}]}')).toBe(false);
  });

  it('follows the selected track: another audio track gives another logo', () => {
    const tracks = [
      audio({ id: 1, codec: 'TRUEHD', hasDolbyAtmos: true }),
      audio({ id: 2, codec: 'DTS', profile: 'ma' }),
      audio({ id: 3, codec: 'AC3' }),
    ];
    expect(tracks.map((track) => getMediaFormatBadges([video()], track))).toEqual([
      ['dolby-atmos'],
      ['dts-hd'],
      ['dolby-digital'],
    ]);
  });

  it('understands media analysed before the new fields existed', () => {
    // Old data: only the color space and the title carried the HDR information
    expect(isHdrVideoTrack(video({ colorSpace: 'bt2020nc' }))).toBe(true);
    expect(isHdrVideoTrack(video({ displayTitle: '4K HDR10 (HEVC)' }))).toBe(true);
    expect(isHdrVideoTrack(video({ colorSpace: 'bt709' }))).toBe(false);
  });

  it('ignores embedded cover art when looking for the picture track', () => {
    const cover = video({ codec: 'MJPEG', colorSpace: 'bt2020nc' });
    const movie = video({ hdrFormat: '' });
    expect(getMainVideoTrack([cover, movie])).toBe(movie);
    expect(getMediaFormatBadges([cover, movie], null)).toEqual([]);
  });

  it('asks for a one-time re-analysis for tracks never checked for Atmos, DTS:X or Dolby Vision', () => {
    const checked = [video({ hasDolbyVision: false })];
    expect(needsMediaFormatAnalysis([audio({ codec: 'TRUEHD' })], checked)).toBe(true);
    expect(needsMediaFormatAnalysis([audio({ codec: 'EAC3', hasDolbyAtmos: false })], checked)).toBe(false);
    expect(needsMediaFormatAnalysis([audio({ codec: 'AC3' }), audio({ codec: 'AAC' })], checked)).toBe(false);
    expect(needsMediaFormatAnalysis([audio({ codec: 'DTS', profile: 'ma' })], checked)).toBe(true);
    expect(needsMediaFormatAnalysis([audio({ codec: 'DTS', profile: 'ma', hasDtsX: false })], checked)).toBe(false);
    expect(needsMediaFormatAnalysis([audio({ codec: 'AC3' })], [video()])).toBe(true);
    expect(needsMediaFormatAnalysis(undefined, undefined)).toBe(false);
  });
});
