import path from 'node:path';

export type SongVariantKind = 'vocals' | 'inst' | 'atmos';

export interface SongVariant {
  kind: SongVariantKind;
  /** Name of the original song file without extension (e.g. "track" for "track.atmos.m4a"). */
  baseName: string;
}

const VARIANT_NAME_PATTERN = /^(.+)\.(vocals|inst|atmos)$/i;

/**
 * Detects files that accompany a song instead of being songs themselves:
 * `name.vocals.ext`, `name.inst.ext` and `name.atmos.ext`.
 */
export function getSongVariant(filePath: string): SongVariant | null {
  const match = VARIANT_NAME_PATTERN.exec(path.parse(filePath).name);
  if (!match) return null;

  return { baseName: match[1], kind: match[2].toLowerCase() as SongVariantKind };
}

export function isSongVariantFile(filePath: string): boolean {
  return getSongVariant(filePath) !== null;
}
