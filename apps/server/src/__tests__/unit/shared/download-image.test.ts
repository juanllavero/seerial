import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { downloadImage } from '@/utils/utils';

const calls: string[] = [];

jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  fileSystemService: {
    createFolder: jest.fn((folder: string) => calls.push(`createFolder:${folder}`)),
    createWriteStream: jest.fn((file: string) => {
      calls.push(`createWriteStream:${file}`);
      return new PassThrough();
    }),
  },
}));
jest.mock('@/utils/network-security', () => ({ isSafePublicHttpUrl: jest.fn().mockResolvedValue(true) }));
jest.mock('axios', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ data: Readable.from([Buffer.from('image')]) }),
}));

describe('downloadImage', () => {
  it('creates the destination folder before writing (the media folder of a series may not exist)', async () => {
    const file = path.join('series', 'Dragon Ball', 'media', 'cover.jpg');

    await downloadImage('https://example.com/cover.jpg', file);

    expect(calls).toEqual([
      `createFolder:${path.dirname(file)}`,
      `createWriteStream:${file}`,
    ]);
  });
});
