interface CollectionEntry {
  /** Position given by the user, starting at 1. 0 while it has none */
  collectionOrder?: number | null;
  year?: string | null;
}

const compareYears = (a?: string | null, b?: string | null) => {
  if (!a || !b) return Number(!a) - Number(!b);
  return a.localeCompare(b);
};

/**
 * Items of a collection: first the ones the user has placed, in that order; the rest (all of them in
 * a collection never reordered, or the ones added later) from the oldest to the newest.
 */
export const sortCollectionItems = <T extends CollectionEntry>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const positionA = a.collectionOrder || Number.MAX_SAFE_INTEGER;
    const positionB = b.collectionOrder || Number.MAX_SAFE_INTEGER;
    return positionA - positionB || compareYears(a.year, b.year);
  });
