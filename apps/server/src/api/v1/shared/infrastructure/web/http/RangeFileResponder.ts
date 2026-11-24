import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';

export type ByteRange = { start: number; end: number };

/**
 * Result of reading a `Range` header against a file size.
 * - `null`: no (usable) range, answer with the whole file.
 * - `'unsatisfiable'`: the range is valid but starts past the end of the file (416).
 */
export type RangeResult = ByteRange | 'unsatisfiable' | null;

/**
 * Parses a single `bytes=` range (RFC 7233): `a-b`, `a-` and the suffix form `-n`.
 * The end is clamped to the last byte of the file. Malformed headers, ranges whose end precedes
 * their start, other units and multiple ranges are ignored (the whole file is sent), which the RFC
 * allows and which is what players expect from a plain file server.
 */
export function parseRangeHeader(header: string | undefined, size: number): RangeResult {
  if (!header) return null;

  const match = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (size === 0) return 'unsatisfiable';

  // Suffix range: the last `n` bytes
  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength === 0) return 'unsatisfiable';
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return 'unsatisfiable';

  if (rawEnd === '') return { start, end: size - 1 };

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return null;

  return { start, end: Math.min(end, size - 1) };
}

interface ServeFileOptions {
  req: Request;
  res: Response;
  size: number;
  contentType: string;
  /** Opens the file (or a byte range of it) for reading. */
  open: (range?: ByteRange) => Readable;
  headers?: Record<string, string>;
}

/**
 * Serves a file with `Range` support.
 * - `HEAD` answers with the headers only and never reads the file.
 * - The read stream is destroyed as soon as the client goes away (players abort connections on
 *   every seek), so file handles are not leaked and nothing keeps reading for nobody.
 * - Read errors never throw after the headers were sent: the connection is dropped instead.
 */
export function serveFileWithRanges({
  req,
  res,
  size,
  contentType,
  open,
  headers = {},
}: ServeFileOptions): void {
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    ...headers,
  };

  const range = parseRangeHeader(req.headers.range, size);

  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
    res.end();
    return;
  }

  if (range) {
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': range.end - range.start + 1,
    });
  } else {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': size });
  }

  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }

  const stream = open(range ?? undefined);
  let finished = false;

  const release = () => {
    if (!finished) {
      finished = true;
      stream.destroy();
    }
  };

  res.on('close', release);
  stream.on('error', () => {
    // Headers are already out: the only honest answer left is to close the connection
    finished = true;
    res.destroy();
  });
  stream.on('end', () => {
    finished = true;
  });

  stream.pipe(res);
}
