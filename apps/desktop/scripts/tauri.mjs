// Runs the Tauri CLI with the native libmpv set up for this platform:
//   node scripts/tauri.mjs dev     (Vite + Rust hot reload + native window)
//   node scripts/tauri.mjs build   (installer / .app + .dmg)
//
// macOS: uses the libmpv bundled in src-tauri/lib/macos (scripts/bundle-libmpv-macos.mjs) and adds
// its config overlay (frameworks + Vulkan ICD). Without it, dev falls back to Homebrew's libmpv.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [command = 'dev', ...rest] = process.argv.slice(2);
const args = ['exec', 'tauri', command, ...rest];
const env = { ...process.env };

if (process.platform === 'darwin') {
  const overlay = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src-tauri/lib/macos/tauri.libmpv.json',
  );
  if (existsSync(overlay)) {
    args.push('--config', overlay);
  } else if (command === 'build') {
    console.error('Bundled libmpv not found. Run: node scripts/bundle-libmpv-macos.mjs');
    process.exit(1);
  } else {
    const brew = ['/opt/homebrew', '/usr/local'].find((p) => existsSync(`${p}/lib/libmpv.dylib`));
    if (!brew) {
      console.error('libmpv not found. Run `node scripts/bundle-libmpv-macos.mjs` (needs: brew install mpv)');
      process.exit(1);
    }
    const lib = `${brew}/lib`;
    env.LIBRARY_PATH = [lib, env.LIBRARY_PATH].filter(Boolean).join(':');
    env.DYLD_FALLBACK_LIBRARY_PATH = [lib, env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(':');
  }
}

const child = spawn('pnpm', args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
