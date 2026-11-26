import type { Chapter } from '@seerial/domain';

/** Placeholder older servers store for chapters whose title they did not read. */
const LEGACY_UNTITLED = 'Sin título';

/**
 * Makes the chapters of any server version usable: the start must be a number to seek to it
 * (older servers send it as text) and untitled chapters are named by their order.
 */
export function normalizeChapters(
  chapters: Chapter[],
  nameByNumber: (number: number) => string,
): Chapter[] {
  return chapters.map((chapter, index) => ({
    ...chapter,
    time: Number(chapter.time) || 0,
    // Older Windows servers send backslashes, which their image endpoint does not understand
    thumbnailSrc: chapter.thumbnailSrc?.replace(/\\/g, '/') ?? '',
    title:
      chapter.title && chapter.title !== LEGACY_UNTITLED ? chapter.title : nameByNumber(index + 1),
  }));
}
