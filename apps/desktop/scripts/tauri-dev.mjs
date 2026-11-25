// Runs `tauri dev` (Vite + Rust hot reload + native window).
// On macOS it points the linker/loader at Homebrew's libmpv.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const env = { ...process.env };

if (process.platform === 'darwin') {
  const brew = ['/opt/homebrew', '/usr/local'].find((p) => existsSync(`${p}/lib/libmpv.dylib`));
  if (!brew) {
    console.error('libmpv not found. Install it with: brew install mpv');
    process.exit(1);
  }
  const lib = `${brew}/lib`;
  env.LIBRARY_PATH = [lib, env.LIBRARY_PATH].filter(Boolean).join(':');
  env.PKG_CONFIG_PATH = [`${lib}/pkgconfig`, env.PKG_CONFIG_PATH].filter(Boolean).join(':');
  env.DYLD_FALLBACK_LIBRARY_PATH = [lib, env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(':');
}

const child = spawn('pnpm', ['exec', 'tauri', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
