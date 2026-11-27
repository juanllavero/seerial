import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';

/**
 * macOS update without Squirrel.Mac (it only accepts apps signed with an Apple Developer ID, and
 * this one is ad-hoc signed): download the new .app zip, then a detached shell script waits for
 * this process to exit, swaps the bundle in place and opens it again.
 * Files downloaded by the app itself are not quarantined, so Gatekeeper does not block them.
 */

/** Seerial Media Server.app, from Contents/MacOS/<executable>. */
export function currentAppBundle(): string {
  return path.resolve(path.dirname(process.execPath), '..', '..');
}

export async function downloadVerified(
  url: string,
  sha512Base64: string,
  destination: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const response = await axios.get(url, { responseType: 'stream', maxRedirects: 10 });
  const total = Number(response.headers['content-length'] ?? 0);
  const hash = crypto.createHash('sha512');
  let received = 0;
  let lastPercent = -1;

  response.data.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    const percent = total ? Math.floor((received / total) * 100) : 0;
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress(percent);
    }
  });
  await pipeline(response.data, fs.createWriteStream(destination));

  if (hash.digest('base64') !== sha512Base64) {
    fs.rmSync(destination, { force: true });
    throw new Error('Downloaded update does not match its checksum');
  }
}

/** Extracts the zip (ditto keeps the code signature and symlinks) and returns the new .app path. */
export async function extractApp(zipPath: string, workDir: string): Promise<string> {
  const outDir = path.join(workDir, 'extracted');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/ditto', ['-x', '-k', zipPath, outDir]);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ditto exited with ${code}`)),
    );
  });
  const app = fs.readdirSync(outDir).find((f) => f.endsWith('.app'));
  if (!app) throw new Error('The update does not contain an .app');
  return path.join(outDir, app);
}

/** Launches the script that replaces `target` with `newApp` once this process has exited. */
export function scheduleReplaceAndRelaunch(newApp: string, target: string, workDir: string): void {
  const script = path.join(workDir, 'install.sh');
  fs.writeFileSync(
    script,
    `#!/bin/sh
PID="$1"; NEW="$2"; APP="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && mv "$NEW" "$APP"; then
  rm -rf "$APP.old"
else
  [ -d "$APP.old" ] && [ ! -d "$APP" ] && mv "$APP.old" "$APP"
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"
`,
    { mode: 0o755 },
  );
  const child = spawn('/bin/sh', [script, String(process.pid), newApp, target], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
