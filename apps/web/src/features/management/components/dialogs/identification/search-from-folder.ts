const VIDEO_EXTENSION = /\.(mkv|mp4|m4v|avi|mov|wmv|webm|flv|mpe?g|m2ts|ts|iso)$/i;

/**
 * Name and year written in the folder of a movie or series (the file of a movie without folder),
 * read as the server does when it scans: "Seven (1995)" is Seven, 1995.
 */
export function searchFromFolder(folder: string): { name: string; year: string } {
  const base = (folder.split(/[/\\]/).filter(Boolean).pop() ?? '').replace(VIDEO_EXTENSION, '');
  const clean = base.replace(/[()]/g, '').replace(/\s{2,}/g, ' ').trim();
  const [, rawName = '', year = ''] = /^(.*?)(?:[\s.-]*(\d{4}))?$/.exec(clean) ?? [];
  const name = rawName
    .replace(/[-_]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // A title that is only a number ("1917") is not a year
  return name ? { name, year } : { name: clean, year: '' };
}
