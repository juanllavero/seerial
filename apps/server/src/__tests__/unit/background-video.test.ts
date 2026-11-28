jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  fileSystemService: { getExternalPath: (relative: string) => relative },
}));

import { pillarboxAspect } from '@/api/v1/videos/infrastructure/services/backgroundVideo';

describe('side bars of background videos', () => {
  it('gives the shape of the picture between them', () => {
    const log = 'crop=1424:1080:248:0\n[cropdetect] crop=1440:1080:240:0\n';

    expect(pillarboxAspect(log, 1920, 1080)).toBeCloseTo(4 / 3);
  });

  it('is nothing without bars, or with a dark area on one side only', () => {
    expect(pillarboxAspect('crop=1920:1080:0:0', 1920, 1080)).toBeUndefined();
    expect(pillarboxAspect('crop=1600:1080:320:0', 1920, 1080)).toBeUndefined();
    expect(pillarboxAspect('', 1920, 1080)).toBeUndefined();
  });
});
