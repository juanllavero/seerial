export const PLAYLISTS_FOLDER_NAME = 'playlists';

/**
 * Returns true when a folder name is the special "Playlists" folder
 * whose sub-folders are registered as playlists (case-insensitive).
 */
export function isPlaylistsFolderName(folderName: string): boolean {
  return folderName.trim().toLowerCase() === PLAYLISTS_FOLDER_NAME;
}

/**
 * Returns true when filePath is located inside folderPath, ignoring case and separator style.
 */
export function isPathInsideFolder(filePath: string, folderPath: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/[/\\]+/g, '/')
      .replace(/\/$/, '')
      .toLowerCase();
  return normalize(filePath).startsWith(`${normalize(folderPath)}/`);
}
