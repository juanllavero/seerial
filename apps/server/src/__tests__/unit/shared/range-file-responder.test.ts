import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import {
  parseRangeHeader,
  serveFileWithRanges,
} from '@/api/v1/shared/infrastructure/web/http/RangeFileResponder';

describe('parseRangeHeader', () => {
  const SIZE = 1000;

  it('returns null when there is no range or it cannot be understood (whole file is sent)', () => {
    expect(parseRangeHeader(undefined, SIZE)).toBeNull();
    expect(parseRangeHeader('', SIZE)).toBeNull();
    expect(parseRangeHeader('bytes=', SIZE)).toBeNull();
    expect(parseRangeHeader('bytes=-', SIZE)).toBeNull();
    expect(parseRangeHeader('bytes=abc-def', SIZE)).toBeNull();
    expect(parseRangeHeader('items=0-10', SIZE)).toBeNull();
    // Multiple ranges are not served: the whole file is
    expect(parseRangeHeader('bytes=0-10,20-30', SIZE)).toBeNull();
    // End before start is invalid, not "unsatisfiable"
    expect(parseRangeHeader('bytes=500-100', SIZE)).toBeNull();
  });

  it('parses closed, open-ended and suffix ranges', () => {
    expect(parseRangeHeader('bytes=0-99', SIZE)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=100-', SIZE)).toEqual({ start: 100, end: 999 });
    expect(parseRangeHeader('bytes=-100', SIZE)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader('BYTES=5-6', SIZE)).toEqual({ start: 5, end: 6 });
    expect(parseRangeHeader(' bytes= 5 - 6 ', SIZE)).toEqual({ start: 5, end: 6 });
  });

  it('clamps the end to the last byte and a long suffix to the whole file', () => {
    expect(parseRangeHeader('bytes=0-999999999999', SIZE)).toEqual({ start: 0, end: 999 });
    expect(parseRangeHeader('bytes=990-5000', SIZE)).toEqual({ start: 990, end: 999 });
    expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('is unsatisfiable when it starts at or past the end, or for an empty suffix', () => {
    expect(parseRangeHeader('bytes=1000-', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=1000-2000', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=-0', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=0-10', 0)).toBe('unsatisfiable');
  });

  it('ignores numbers that are not safe integers', () => {
    expect(parseRangeHeader('bytes=99999999999999999999-', SIZE)).toBeNull();
  });
});

describe('serveFileWithRanges', () => {
  const content = Buffer.from(Array.from({ length: 5000 }, (_v, i) => i % 251));
  let dir: string;
  let file: string;
  let opened: number;
  let lastStream: Readable | null;

  const buildApp = (openOverride?: (range?: { start: number; end: number }) => Readable) => {
    const app = express();
    app.get('/file', (req, res) => {
      serveFileWithRanges({
        req,
        res,
        size: content.length,
        contentType: 'video/x-matroska',
        headers: { 'X-Extra': 'yes' },
        open:
          openOverride ??
          ((range) => {
            opened++;
            lastStream = fs.createReadStream(file, range);
            return lastStream;
          }),
      });
    });
    return app;
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'range-'));
    file = path.join(dir, 'movie.mkv');
    fs.writeFileSync(file, content);
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    opened = 0;
    lastStream = null;
  });

  const get = (headers: Record<string, string> = {}) =>
    request(buildApp()).get('/file').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).set(headers);

  it('sends the whole file with 200 and the headers a player needs', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('5000');
    expect(res.headers['content-type']).toBe('video/x-matroska');
    expect(res.headers['x-extra']).toBe('yes');
    expect(res.body.equals(content)).toBe(true);
  });

  it('serves closed, open-ended and suffix ranges with the right bytes', async () => {
    const closed = await get({ Range: 'bytes=10-19' });
    expect(closed.status).toBe(206);
    expect(closed.headers['content-range']).toBe('bytes 10-19/5000');
    expect(closed.body.equals(content.subarray(10, 20))).toBe(true);

    const open = await get({ Range: 'bytes=4990-' });
    expect(open.headers['content-range']).toBe('bytes 4990-4999/5000');
    expect(open.body.equals(content.subarray(4990))).toBe(true);

    const suffix = await get({ Range: 'bytes=-16' });
    expect(suffix.status).toBe(206);
    expect(suffix.headers['content-range']).toBe('bytes 4984-4999/5000');
    expect(suffix.body.equals(content.subarray(4984))).toBe(true);
  });

  it('clamps a range that ends past the file instead of promising bytes it cannot send', async () => {
    const res = await get({ Range: 'bytes=4000-999999999' });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 4000-4999/5000');
    expect(res.headers['content-length']).toBe('1000');
    expect(res.body.length).toBe(1000);
  });

  it('answers 416 with the file size when the range starts past the end', async () => {
    const res = await get({ Range: 'bytes=6000-' });

    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */5000');
    expect(opened).toBe(0);
  });

  it('answers HEAD with the headers only and never opens the file', async () => {
    const res = await request(buildApp()).head('/file');

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('5000');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(opened).toBe(0);
  });

  it('serves an empty file without opening it', async () => {
    const app = express();
    app.get('/empty', (req, res) =>
      serveFileWithRanges({ req, res, size: 0, contentType: 'video/mp4', open: () => { throw new Error('must not open'); } }),
    );

    const res = await request(app).get('/empty');
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('0');
  });

  it('releases the file as soon as the client aborts', async () => {
    const big = path.join(dir, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(64 * 1024 * 1024));
    let stream: Readable | null = null;
    const app = express();
    app.get('/big', (req, res) =>
      serveFileWithRanges({
        req,
        res,
        size: 64 * 1024 * 1024,
        contentType: 'video/mp4',
        open: (range) => {
          stream = fs.createReadStream(big, range);
          return stream;
        },
      }),
    );
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve) => {
      const req = http.get({ port, path: '/big' }, (res) => {
        res.once('data', () => {
          req.destroy(); // a seek: the player drops the connection
          resolve();
        });
      });
      req.on('error', () => undefined);
    });

    const deadline = Date.now() + 3000;
    while (!(stream as Readable | null)?.destroyed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    server.close();

    expect((stream as Readable | null)?.destroyed).toBe(true);
  });

  it('drops the connection (and does not crash) when reading fails after the headers', async () => {
    const failing = buildApp(() => {
      const stream = fs.createReadStream(path.join(dir, 'does-not-exist.bin'));
      return stream;
    });
    const server = failing.listen(0);
    const { port } = server.address() as AddressInfo;

    const outcome = await new Promise<string>((resolve) => {
      const req = http.get({ port, path: '/file' }, (res) => {
        res.on('error', () => resolve('connection-dropped'));
        res.on('close', () => resolve('connection-dropped'));
        res.on('end', () => resolve('ended'));
        res.resume();
      });
      req.on('error', () => resolve('connection-dropped'));
    });
    server.close();

    expect(outcome).toBe('connection-dropped');
  });
});
