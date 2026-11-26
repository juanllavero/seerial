import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Local images of the content: one file per kind in its folder (poster.jpg, logo.png...).
 *
 * These are files of the user, so every write follows the same rules: the new image is complete and
 * checked before anything is touched, and the previous one is only removed once the new one is there.
 */

export const ARTWORK_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'];

/** Enough to recognize any format: SVG files can start with a declaration and comments */
const HEADER_BYTES = 4096;

export interface ArtworkSlot {
  folder: string;
  /** File name without extension: poster, logo, background, cover, season01-background */
  name: string;
}

/** Logos are often SVG, which is text */
function isSvg(buffer: Buffer): boolean {
  const text = buffer.toString('utf8', 0, HEADER_BYTES).trimStart();
  // A byte order mark is removed by trimStart, like any other space
  const prolog = ['<?xml', '<!--', '<!DOCTYPE svg'].some((start) => text.startsWith(start));
  return text.startsWith('<svg') || (prolog && text.includes('<svg'));
}

/** Extension of an image according to its content, or null when it is not an image */
export function detectImageExtension(buffer: Buffer): string | null {
  if (isSvg(buffer)) return '.svg';
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return '.png';
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return '.gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return '.webp';
  }
  if (['ftypavif', 'ftypavis'].includes(buffer.toString('ascii', 4, 12))) return '.avif';
  return null;
}

function filesOfSlot({ folder, name }: ArtworkSlot): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return [];
  }

  return entries.filter((entry) => {
    const { name: stem, ext } = path.parse(entry);
    return stem.toLowerCase() === name && ARTWORK_EXTENSIONS.includes(ext.toLowerCase());
  });
}

/** Path of the local image of a slot, or null. With several extensions, the newest one wins */
export function findArtwork(slot: ArtworkSlot): string | null {
  const files = filesOfSlot(slot).map((file) => path.join(slot.folder, file));
  if (files.length <= 1) return files[0] ?? null;

  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/** Path for a temporary file next to the final one, so that renaming it is atomic */
export function temporaryArtworkPath(slot: ArtworkSlot): string {
  return path.join(slot.folder, `.${slot.name}-${randomUUID().slice(0, 8)}.tmp`);
}

/**
 * Turns a complete temporary file into the image of the slot, replacing the previous one whatever
 * its extension. The temporary file is removed when it is not an image.
 */
export function commitArtwork(slot: ArtworkSlot, temporaryFile: string): string {
  const header = Buffer.alloc(HEADER_BYTES);
  const descriptor = fs.openSync(temporaryFile, 'r');
  try {
    fs.readSync(descriptor, header, 0, HEADER_BYTES, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  const extension = detectImageExtension(header);
  if (!extension) {
    fs.rmSync(temporaryFile, { force: true });
    throw new Error('The file is not a valid image');
  }

  const destination = path.join(slot.folder, `${slot.name}${extension}`);
  const previous = filesOfSlot(slot).map((file) => path.join(slot.folder, file));
  fs.renameSync(temporaryFile, destination);

  for (const file of previous) {
    // Windows paths do not distinguish case: Poster.JPG is the file just written
    if (file.toLowerCase() !== destination.toLowerCase()) fs.rmSync(file, { force: true });
  }

  return destination;
}

/** Copies (or moves) an existing image into the slot */
export function storeArtworkFile(slot: ArtworkSlot, source: string, move = false): string {
  fs.mkdirSync(slot.folder, { recursive: true });
  const temporaryFile = temporaryArtworkPath(slot);
  fs.copyFileSync(source, temporaryFile);
  const destination = commitArtwork(slot, temporaryFile);

  if (move && path.resolve(source).toLowerCase() !== path.resolve(destination).toLowerCase()) {
    fs.rmSync(source, { force: true });
  }

  return destination;
}

export function storeArtworkBuffer(slot: ArtworkSlot, content: Buffer): string {
  if (!detectImageExtension(content)) throw new Error('The file is not a valid image');

  fs.mkdirSync(slot.folder, { recursive: true });
  const temporaryFile = temporaryArtworkPath(slot);
  fs.writeFileSync(temporaryFile, content);
  return commitArtwork(slot, temporaryFile);
}
