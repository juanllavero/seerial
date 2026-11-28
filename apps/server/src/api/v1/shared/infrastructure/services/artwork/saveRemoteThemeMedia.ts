import fs from 'node:fs';
import path from 'node:path';
import { downloadImage, isRemoteUrl } from '@/utils/downloadImage';
import type { ArtworkEntity } from './ArtworkService';
import {
  commitThemeMedia,
  removeTemporaryFiles,
  temporaryStem,
  type ThemeKind,
  type ThemeOwner,
  themeMediaSlot,
} from './themeMedia';

const FIELDS: { field: string; kind: ThemeKind; extension: string }[] = [
  { field: 'videoSrc', kind: 'video', extension: '.mp4' },
  { field: 'musicSrc', kind: 'theme', extension: '.mp3' },
];

/**
 * Theme and background video given by address in an edit: saved in local, and `data` gets the path.
 * The address is kept when the download fails.
 */
export async function saveRemoteThemeMedia(
  owner: ThemeOwner,
  data: object,
  findEntity: () => Promise<ArtworkEntity | null | undefined>,
): Promise<void> {
  const values = data as Record<string, string | undefined>;
  const remote = FIELDS.filter(({ field }) => values[field] && isRemoteUrl(values[field]));
  if (remote.length === 0) return;

  const entity = await findEntity();
  if (!entity) return;

  for (const { field, kind, extension } of remote) {
    const url = values[field] as string;
    try {
      const slot = await themeMediaSlot(owner, entity, kind);
      if (!slot) continue;

      fs.mkdirSync(slot.folder, { recursive: true });
      const stem = temporaryStem(slot);
      try {
        await downloadImage(url, `${stem}${path.extname(new URL(url).pathname) || extension}`);
        const file = commitThemeMedia(slot, kind, stem, { overwrite: true });
        if (file) values[field] = file;
      } finally {
        removeTemporaryFiles(stem);
      }
    } catch {
      // Keep the address if the download fails
    }
  }
}
