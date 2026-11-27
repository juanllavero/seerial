// Decides which apps must be released for the current commit and computes their versions.
//
//   node .github/scripts/release-info.mjs            -> writes GitHub Actions outputs
//   node .github/scripts/release-info.mjs --print    -> prints them (local check)
//
// An app is released when something it is built from changed since its last release tag
// (server-v* / desktop-v*), so a failed run is retried on the next push. Version:
// MAJOR.MINOR from the app's own manifest (bump it by hand when you want) + PATCH = commit count,
// which always grows and is reproducible. Release notes = commit subjects since the last tag.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const force = (process.env.FORCE ?? '').split(',').filter(Boolean);

// Changes that never produce a new build (docs, tests, editor files)
const IGNORED = [':(exclude,glob)**/*.md', ':(exclude,glob)**/__tests__/**', ':(exclude,glob)**/*.test.ts'];

const apps = {
  server: {
    tagPrefix: 'server-v',
    paths: ['apps/server', 'apps/web', 'libs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
    baseVersion: () => JSON.parse(fs.readFileSync('apps/server/package.json', 'utf8')).version,
  },
  desktop: {
    tagPrefix: 'desktop-v',
    paths: ['apps/desktop', 'libs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
    baseVersion: () => JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8')).version,
  },
};

const commitCount = git('rev-list', '--count', 'HEAD');
const outputs = {};
const notesDir = process.env.RUNNER_TEMP ?? '.';

for (const [name, app] of Object.entries(apps)) {
  let lastTag = '';
  try {
    lastTag = git('describe', '--tags', '--abbrev=0', '--match', `${app.tagPrefix}*`, 'HEAD');
  } catch {
    // never released
  }

  const pathspec = [...app.paths, ...IGNORED];
  let changed = !lastTag || force.includes(name);
  if (!changed) {
    try {
      git('diff', '--quiet', lastTag, 'HEAD', '--', ...pathspec);
    } catch {
      changed = true;
    }
  }

  const [major, minor] = app.baseVersion().split('.');
  const version = `${major}.${minor}.${commitCount}`;
  const range = lastTag ? [`${lastTag}..HEAD`] : ['-n', '30', 'HEAD'];
  const notes = git('log', '--no-merges', '--pretty=format:- %s', ...range, '--', ...pathspec) || '- Maintenance build';
  const notesFile = path.join(notesDir, `${name}-notes.md`);
  fs.writeFileSync(notesFile, `${notes}\n`);

  Object.assign(outputs, {
    [`${name}_changed`]: String(changed),
    [`${name}_version`]: version,
    [`${name}_last_tag`]: lastTag,
    [`${name}_notes_file`]: notesFile,
  });
}

if (process.argv.includes('--print') || !process.env.GITHUB_OUTPUT) {
  console.log(outputs);
} else {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`,
  );
  console.log(outputs);
}
