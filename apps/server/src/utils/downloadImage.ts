import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { fileSystemService } from '@/api/v1/shared/infrastructure/adapters/di/container';
import { isSafePublicHttpUrl } from './network-security';

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

/**
 * Downloads a remote image URL and saves it to the given destination path.
 * Ensures the parent directory exists before writing. The file is only created once the server
 * answers with the image, and removed if the download is interrupted.
 */
export async function downloadImage(url: string, destPath: string): Promise<void> {
  return downloadImageWithRedirects(url, destPath, 0);
}

async function downloadImageWithRedirects(
  url: string,
  destPath: string,
  redirectCount: number,
): Promise<void> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects while downloading ${url}`);
  }

  if (!(await isSafePublicHttpUrl(url))) {
    throw new Error(`Blocked remote URL: ${url}`);
  }

  fileSystemService.createFolder(path.dirname(destPath));

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const fail = (error: Error) => {
      fileSystemService.deleteFile(destPath);
      reject(error);
    };

    const request = protocol.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.resume();
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          reject(new Error(`Redirect with no location header from ${url}`));
          return;
        }
        downloadImageWithRedirects(new URL(redirectUrl, url).href, destPath, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const file = fileSystemService.createWriteStream(destPath);
      response.pipe(file);
      // 'close' and not 'finish': the file must be closed before it can be renamed
      file.on('close', () => (response.complete ? resolve() : fail(new Error('Interrupted'))));
      file.on('error', fail);
      response.on('error', fail);
      response.on('aborted', () => fail(new Error(`Download of ${url} interrupted`)));
    });

    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error(`Timeout downloading ${url}`)));
    request.on('error', fail);
  });
}

/**
 * Returns true if the given string is a remote HTTP/HTTPS URL.
 */
export function isRemoteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}
