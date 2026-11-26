import { type LibraryItem, LibraryTypes } from '@seerial/domain';
import type { TFunction } from 'i18next';

const COLLECTION_COUNT_KEYS: Record<string, string> = {
  [LibraryTypes.MOVIES]: 'movieCount',
  [LibraryTypes.SHOWS]: 'showCount',
  [LibraryTypes.MUSIC]: 'albumCount',
};

/** Text under a card: collections say how much they hold, the rest show their years. */
export function getCardSubtitle(
  item: LibraryItem,
  libraryType: string | undefined,
  t: TFunction,
): string | undefined {
  const countKey = COLLECTION_COUNT_KEYS[libraryType ?? ''];

  if (item.type === 'collection' && countKey) {
    return t(countKey, { count: item.numberOfItems });
  }

  return item.years;
}

/**
 * What the corner of a card says about the watch state: a tick when watched, or how many episodes
 * (or videos of a movie) are left. Collections show nothing.
 */
export function getCardWatchIndicator(item: LibraryItem): {
  watched?: boolean;
  remainingItems?: number;
} {
  if (item.type !== 'movie' && item.type !== 'series') return {};
  if (item.watched) return { watched: true };
  return { remainingItems: item.remainingItems };
}
