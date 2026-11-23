import { summaryHasDolbyAtmos } from '@/api/v1/shared/infrastructure/adapters/ffmpeg/audioInfo';

jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/nativeFfmpeg', () => ({
  executeFfprobe: jest.fn(),
  readFfmpegStreamSummary: jest.fn(),
}));

describe('summaryHasDolbyAtmos', () => {
  it('detects Atmos in E-AC-3 and TrueHD stream summaries', () => {
    expect(summaryHasDolbyAtmos('Audio: eac3 (Dolby Digital Plus + Dolby Atmos), 48000 Hz, 5.1(side)')).toBe(true);
    expect(summaryHasDolbyAtmos('Audio: truehd (Dolby TrueHD + Dolby Atmos), 48000 Hz')).toBe(
      true,
    );
  });

  it('does not flag regular Dolby Digital Plus or other codecs', () => {
    expect(summaryHasDolbyAtmos('Audio: eac3, 48000 Hz, 5.1(side), fltp, 640 kb/s')).toBe(false);
    expect(summaryHasDolbyAtmos('Audio: flac, 44100 Hz, stereo, s16')).toBe(false);
  });
});
