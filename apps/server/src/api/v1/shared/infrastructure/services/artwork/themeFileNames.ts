import path from 'node:path';

/** Background videos and downloads in progress live next to the content, but are not content */
export function isThemeVideoFile(file: string): boolean {
  const name = path.basename(file);
  return (
    /^(season\d+-)?video\.[^.]+$/i.test(name) ||
    /^\.(season\d+-)?(video|theme)-\w+\.tmp\./i.test(name)
  );
}
