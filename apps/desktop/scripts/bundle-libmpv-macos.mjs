// Copies Homebrew's libmpv and its whole dependency tree into src-tauri/lib/macos so the app
// ships its own mpv (no `brew install mpv` needed on the user's Mac).
//
//   brew install mpv && node scripts/bundle-libmpv-macos.mjs
//
// - Every dylib is renamed to its install name and rewritten to load its deps via @rpath, so they
//   resolve from Contents/Frameworks (tauri-build adds @executable_path/../Frameworks to the rpath).
// - MoltenVK (Vulkan on Metal, used by gpu-api=vulkan) is loaded by the Vulkan loader through an
//   ICD manifest: it is shipped under Resources/vulkan/icd.d and main.rs points VK_DRIVER_FILES at it.
// - Writes lib/macos/tauri.libmpv.json, a config overlay passed to `tauri dev|build --config`.
// - The binaries only run on macOS >= the version Homebrew built them for (the machine's version).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('bundle-libmpv-macos only runs on macOS');
  process.exit(1);
}

const tauriDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src-tauri');
const outDir = path.join(tauriDir, 'lib', 'macos');
const brew = execFileSync('brew', ['--prefix'], { encoding: 'utf8' }).trim();

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const isBrewPath = (p) => p.startsWith(`${brew}/`);

/** Install names this binary loads (excluding its own id). */
function loadCommands(file) {
  const lines = run('otool', ['-L', file]).split('\n').slice(1);
  const id = run('otool', ['-D', file]).split('\n')[1]?.trim();
  return lines
    .map((l) => l.trim().split(' (')[0])
    .filter((p) => p && p !== id);
}

/** Resolves an install name as seen from `fromFile` to a real Homebrew file, or null if it is a system lib. */
function resolveRef(ref, fromFile) {
  let candidate = null;
  if (isBrewPath(ref)) candidate = ref;
  else if (ref.startsWith('@loader_path/')) candidate = path.join(path.dirname(fromFile), ref.slice(13));
  else if (ref.startsWith('@rpath/')) {
    const name = ref.slice(7);
    candidate = [path.dirname(fromFile), `${brew}/lib`].map((d) => path.join(d, name)).find(fs.existsSync);
    if (!candidate) throw new Error(`Cannot resolve ${ref} from ${fromFile}`);
  }
  if (!candidate) return null;
  if (!fs.existsSync(candidate)) throw new Error(`Missing ${candidate} (needed by ${fromFile})`);
  return candidate;
}

const roots = [`${brew}/lib/libmpv.2.dylib`, `${brew}/opt/molten-vk/lib/libMoltenVK.dylib`];
for (const r of roots) {
  if (!fs.existsSync(r)) {
    console.error(`${r} not found. Install it with: brew install mpv molten-vk`);
    process.exit(1);
  }
}

// name (basename of the install name, e.g. libavcodec.62.dylib) -> real source file
const libs = new Map();
const queue = roots.map((r) => ({ ref: r, from: r }));
while (queue.length) {
  const { ref, from } = queue.pop();
  const src = resolveRef(ref, from);
  if (!src) continue;
  const name = path.basename(ref);
  if (libs.has(name)) continue;
  libs.set(name, fs.realpathSync(src));
  for (const dep of loadCommands(src)) queue.push({ ref: dep, from: src });
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const [name, src] of libs) {
  const dst = path.join(outDir, name);
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);

  const args = ['-id', `@rpath/${name}`];
  for (const ref of loadCommands(src)) {
    if (resolveRef(ref, src)) args.push('-change', ref, `@rpath/${path.basename(ref)}`);
  }
  run('install_name_tool', [...args, dst]);
  try {
    run('install_name_tool', ['-add_rpath', '@loader_path', dst]);
  } catch {
    // already present
  }
  run('codesign', ['--force', '--sign', '-', dst]);
}

// The linker looks for libmpv.dylib (-lmpv); the binary records @rpath/libmpv.2.dylib
fs.symlinkSync('libmpv.2.dylib', path.join(outDir, 'libmpv.dylib'));

// Vulkan ICD manifest: library_path is relative to the manifest
// (Contents/Resources/vulkan/icd.d -> Contents/Frameworks, and target/<profile>/vulkan/icd.d -> target/Frameworks in dev)
const icdDir = path.join(outDir, 'vulkan', 'icd.d');
fs.mkdirSync(icdDir, { recursive: true });
const icd = JSON.parse(fs.readFileSync(`${brew}/etc/vulkan/icd.d/MoltenVK_icd.json`, 'utf8'));
icd.ICD.library_path = '../../../Frameworks/libMoltenVK.dylib';
fs.writeFileSync(path.join(icdDir, 'MoltenVK_icd.json'), `${JSON.stringify(icd, null, 2)}\n`);

// Sanity check: nothing may still point into Homebrew
for (const name of libs.keys()) {
  const leftovers = loadCommands(path.join(outDir, name)).filter(isBrewPath);
  if (leftovers.length) throw new Error(`${name} still references ${leftovers.join(', ')}`);
}

const names = [...libs.keys()].sort();
const overlay = {
  bundle: {
    macOS: { frameworks: names.map((n) => `lib/macos/${n}`) },
    resources: { 'lib/macos/vulkan/icd.d/MoltenVK_icd.json': 'vulkan/icd.d/MoltenVK_icd.json' },
  },
};
fs.writeFileSync(path.join(outDir, 'tauri.libmpv.json'), `${JSON.stringify(overlay, null, 2)}\n`);

const mpvVersion = run('brew', ['list', '--versions', 'mpv']).trim();
const size = names.reduce((s, n) => s + fs.statSync(path.join(outDir, n)).size, 0);
fs.writeFileSync(path.join(outDir, 'VERSION'), `${mpvVersion}\n`);
console.log(`Bundled ${mpvVersion}: ${names.length} dylibs, ${(size / 1e6).toFixed(1)} MB -> ${outDir}`);
