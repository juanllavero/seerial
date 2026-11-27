// Publishes a built app to GitHub Releases and points its update channel at it.
//
//   node .github/scripts/publish-release.mjs <server|desktop> <version> <artifacts-dir> <notes-file>
//
// - `<app>-v<version>`: immutable release with every installer (history, manual downloads).
// - `<app>-channel`: fixed release the installed apps poll. It only holds the update manifests,
//   whose URLs point at the versioned release:
//     server  -> latest.yml / latest-mac.yml / latest-linux.yml (electron-updater, generic provider)
//     desktop -> latest.json (tauri-plugin-updater)
// Both are prereleases so GitHub's "latest release" never changes meaning.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [app, version, dir, notesFile] = process.argv.slice(2);
if (!['server', 'desktop'].includes(app) || !version || !dir || !notesFile) {
  console.error('usage: publish-release.mjs <server|desktop> <version> <artifacts-dir> <notes-file>');
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const tag = `${app}-v${version}`;
const channelTag = `${app}-channel`;
const title = app === 'server' ? 'Seerial Server' : 'Seerial Desktop';
const downloadUrl = (name) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
const notes = fs.readFileSync(notesFile, 'utf8').trim();

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const releaseExists = (t) => {
  try {
    gh('release', 'view', t, '--repo', repo, '--json', 'tagName');
    return true;
  } catch {
    return false;
  }
};

const files = fs.readdirSync(dir).map((f) => path.join(dir, f));
const isManifest = (f) => /^latest.*\.(yml|json)$/.test(path.basename(f));
const binaries = files.filter((f) => !isManifest(f));
const manifestDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? '/tmp', `${app}-manifests-`));
const manifests = [];

if (app === 'server') {
  // electron-updater manifests: make file urls absolute (versioned release) and add the notes
  for (const file of files.filter(isManifest)) {
    const yml = fs
      .readFileSync(file, 'utf8')
      .replace(/^(\s*-?\s*url:\s*)(\S+)$/gm, (_, k, v) => `${k}${downloadUrl(v)}`)
      .replace(/^(path:\s*)(\S+)$/gm, (_, k, v) => `${k}${downloadUrl(v)}`)
      .replace(/^releaseNotes:[\s\S]*$/m, '');
    const block = notes
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');
    const out = path.join(manifestDir, path.basename(file));
    fs.writeFileSync(out, `${yml.trimEnd()}\nreleaseNotes: |\n${block}\n`);
    manifests.push(out);
  }
} else {
  // tauri-plugin-updater manifest: one entry per platform, signature = content of the .sig file
  const platforms = {};
  const targets = [
    { key: 'windows-x86_64', re: /-setup\.exe$/ },
    { key: 'darwin-aarch64', re: /\.app\.tar\.gz$/ },
  ];
  for (const { key, re } of targets) {
    const bundle = binaries.find((f) => re.test(f));
    if (!bundle) continue;
    const sig = `${bundle}.sig`;
    if (!fs.existsSync(sig)) throw new Error(`Missing signature for ${bundle}`);
    platforms[key] = { signature: fs.readFileSync(sig, 'utf8').trim(), url: downloadUrl(path.basename(bundle)) };
  }
  if (!Object.keys(platforms).length) throw new Error('No desktop bundles found');
  const out = path.join(manifestDir, 'latest.json');
  fs.writeFileSync(
    out,
    `${JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`,
  );
  manifests.push(out);
}

if (releaseExists(tag)) {
  gh('release', 'upload', tag, '--repo', repo, '--clobber', ...binaries);
} else {
  gh('release', 'create', tag, '--repo', repo, '--target', sha, '--title', `${title} ${version}`,
    '--notes', notes, '--prerelease', '--latest=false', ...binaries);
}

if (!releaseExists(channelTag)) {
  gh('release', 'create', channelTag, '--repo', repo, '--target', sha, '--title', `${title} update channel`,
    '--notes', 'Update manifests polled by the installed apps. Do not delete.', '--prerelease', '--latest=false');
}
gh('release', 'upload', channelTag, '--repo', repo, '--clobber', ...manifests);

console.log(`Published ${tag}; ${channelTag} now points to ${version}`);
