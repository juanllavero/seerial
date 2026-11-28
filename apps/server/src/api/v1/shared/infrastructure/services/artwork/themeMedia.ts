import fs from 'node:fs';
import path from 'node:path';
import { audioExtensions, videoExtensions } from '@/utils/constants';
import { type ArtworkEntity, artworkService } from './ArtworkService';
import type { ArtworkSlot } from './artworkFiles';

/**
 * Theme song and background video of a content: theme.ext and video.ext, in the same folder as its
 * images. A season uses season01-theme.ext, and the general theme.ext when it has none.
 */

export type ThemeKind = 'theme' | 'video';
export type ThemeOwner = 'movie' | 'series' | 'season';

const isOfKind = (file: string, kind: ThemeKind) => {
  const extension = path.extname(file).toLowerCase();
  const extensions = kind === 'theme' ? audioExtensions : videoExtensions;
  return extensions.some((candidate) => candidate.toLowerCase() === extension);
};

function filesOfSlot({ folder, name }: ArtworkSlot, kind: ThemeKind): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => path.parse(entry).name.toLowerCase() === name && isOfKind(entry, kind))
    .map((entry) => path.join(folder, entry));
}

/** File of exactly this slot, or null. With several extensions, the newest one wins */
export function findInSlot(slot: ArtworkSlot, kind: ThemeKind): string | null {
  const files = filesOfSlot(slot, kind);
  if (files.length <= 1) return files[0] ?? null;

  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/** File that plays for a content, or null */
export async function findThemeMedia(
  owner: ThemeOwner,
  entity: ArtworkEntity,
  kind: ThemeKind,
): Promise<string | null> {
  const location = await artworkService.locate(owner, entity);
  if (!location) return null;

  const { folder, prefix } = location;
  return (
    findInSlot({ folder, name: `${prefix}${kind}` }, kind) ??
    (prefix ? findInSlot({ folder, name: kind }, kind) : null)
  );
}

/** Where a file chosen for a content is saved. Null when the content is not reachable */
export async function themeMediaSlot(
  owner: ThemeOwner,
  entity: ArtworkEntity,
  kind: ThemeKind,
): Promise<ArtworkSlot | null> {
  const location = await artworkService.locate(owner, entity);
  if (!location) return null;

  return artworkService.writeSlot(location, owner, entity, kind, (slot) =>
    Boolean(findInSlot(slot, kind)),
  );
}

/** Path without extension for a download in progress, in the folder where it will stay */
export function temporaryStem(slot: ArtworkSlot): string {
  return path.join(slot.folder, `.${slot.name}-${Math.random().toString(36).slice(2, 10)}.tmp`);
}

/** Removes what is left of a download */
export function removeTemporaryFiles(stem: string): void {
  const prefix = `${path.basename(stem)}.`;
  try {
    for (const entry of fs.readdirSync(path.dirname(stem))) {
      if (entry.startsWith(prefix)) fs.rmSync(path.join(path.dirname(stem), entry), { force: true });
    }
  } catch {
    // The folder is gone: nothing to remove
  }
}

/**
 * Turns the finished download of a temporary stem into the file of the slot. Without `overwrite`
 * an existing file always wins. Returns the file of the slot, or null when nothing was downloaded.
 */
export function commitThemeMedia(
  slot: ArtworkSlot,
  kind: ThemeKind,
  stem: string,
  { overwrite }: { overwrite: boolean },
): string | null {
  try {
    const prefix = `${path.basename(stem)}.`;
    const downloaded = fs
      .readdirSync(slot.folder)
      .filter((entry) => entry.startsWith(prefix) && isOfKind(entry, kind))
      .map((entry) => path.join(slot.folder, entry))[0];
    if (!downloaded) return null;

    const previous = filesOfSlot(slot, kind);
    if (!overwrite && previous.length > 0) return previous[0];

    const destination = path.join(
      slot.folder,
      `${slot.name}${path.extname(downloaded).toLowerCase()}`,
    );
    fs.renameSync(downloaded, destination);
    for (const file of previous) {
      // Windows paths do not distinguish case
      if (file.toLowerCase() !== destination.toLowerCase()) fs.rmSync(file, { force: true });
    }

    return destination;
  } finally {
    removeTemporaryFiles(stem);
  }
}
