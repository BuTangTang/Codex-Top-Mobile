#!/usr/bin/env node

// @ts-check

import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNumericPlanetFrame } from '../../../packages/cli-common/numericPlanetFrame.mjs';

import {
  INSTALLER_FILENAMES,
  INSTALLER_PUBLISH_SPECS,
  applyInstallerPublishTransform,
} from './installers/catalog.mjs';

function parseArgs(argv) {
  const kv = new Map();
  const flags = new Set();
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    if (arg.includes('=')) {
      const idx = arg.indexOf('=');
      kv.set(arg.slice(0, idx), arg.slice(idx + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      kv.set(arg, next);
      i += 1;
      continue;
    }
    flags.add(arg);
  }
  return { kv, flags, positionals };
}

function resolveRepoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..');
}

export { INSTALLER_FILENAMES, INSTALLER_PUBLISH_SPECS, applyInstallerPublishTransform } from './installers/catalog.mjs';

async function readFileOrNull(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function buffersEqual(left, right) {
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.equals(right);
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

// Project the CLI's numeric globe at authoring time: shipped installers remain
// standalone Bash/PowerShell, with no renderer or JavaScript runtime dependency.
function projectInstallerPlanet(source, filename) {
  const marker = /^([ \t]*)# BEGIN GENERATED NUMERIC PLANET\n[\s\S]*?^[ \t]*# END GENERATED NUMERIC PLANET/m;
  if (!source.includes('# BEGIN GENERATED NUMERIC PLANET')) return source;
  if (!marker.test(source)) throw new Error('Unterminated installer planet projection: ' + filename);
  const frame = createNumericPlanetFrame({ columns: 28, seconds: 1.6 });
  const plain = frame.map((row) => row.map((cell) => cell?.digit ?? ' ').join(''));
  const colored = frame.map((row) => row.map((cell) => cell
    ? '\\033[38;2;' + cell.rgb.join(';') + 'm' + cell.digit
    : ' ').join('') + '\\033[0m');
  const lines = filename.endsWith('.sh')
    ? [
        'HAPPIER_INSTALLER_ART_ROWS=(',
        ...plain.map((row) => "  '" + row + "'"), ')',
        'HAPPIER_INSTALLER_ART_RGB_ROWS=(',
        ...colored.map((row) => "  $'" + row + "'"), ')',
      ]
    : [
        '$rows = @(',
        ...plain.map((row, index) => "  '" + row + "'" + (index < plain.length - 1 ? ',' : '')), ')',
        '$rgbRows = @(',
        ...colored.map((row, index) => '  "' + row.replaceAll('\\033', '$([char]27)') + '"' + (index < colored.length - 1 ? ',' : '')), ')',
      ];
  return source.replace(marker, (_match, indent) => [
    '# BEGIN GENERATED NUMERIC PLANET',
    ...lines,
    '# END GENERATED NUMERIC PLANET',
  ].map((line) => indent + line).join('\n'));
}

export async function syncInstallers({
  sourceDir,
  targetDir,
  checkOnly = false,
}) {
  const changed = [];
  const checked = [];
  await mkdir(targetDir, { recursive: true });

  const desiredTargetMode = 0o644;
  for (const spec of INSTALLER_PUBLISH_SPECS) {
    const sourcePath = join(sourceDir, spec.source);
    let sourceContents = await readFileOrNull(sourcePath);
    if (!sourceContents) {
      throw new Error(`[release] missing installer source file: ${sourcePath}`);
    }
    const projected = Buffer.from(projectInstallerPlanet(sourceContents.toString('utf8'), spec.source));
    if (!buffersEqual(sourceContents, projected)) {
      if (checkOnly) throw new Error('[release] installer source planet is out of sync: ' + sourcePath);
      await writeFile(sourcePath, projected);
      sourceContents = projected;
    }
    const publishedContents = applyInstallerPublishTransform(sourceContents, spec.transform);

    for (const name of spec.targets) {
      const targetPath = join(targetDir, name);
      const targetContents = await readFileOrNull(targetPath);
      checked.push(name);

      const contentInSync = buffersEqual(publishedContents, targetContents);
      if (!contentInSync) {
        changed.push(name);
        if (!checkOnly) {
          await writeFile(targetPath, publishedContents);
        }
        continue;
      }

      // Even when the file contents match, normalize the published copy's mode so
      // "executable bit" drift doesn't create noisy diffs in the repo.
      if (!checkOnly && (await fileExists(targetPath))) {
        await chmod(targetPath, desiredTargetMode);
      }
    }
  }

  // Note: chmod doesn't report whether it changed anything; "changed" is content drift only.
  // We intentionally keep this simple: mode normalization is best-effort hygiene.

  if (checkOnly && changed.length > 0) {
    throw new Error(`[release] installer artifacts are out of sync: ${changed.join(', ')}`);
  }

  return {
    ok: true,
    checkOnly,
    checked,
    changed,
    sourceDir,
    targetDir,
  };
}

async function main() {
  const repoRoot = resolveRepoRoot();
  const { kv, flags } = parseArgs(process.argv.slice(2));
  const checkOnly = flags.has('--check');
  const sourceDir = resolve(String(kv.get('--source-dir') ?? join(repoRoot, 'scripts', 'release', 'installers')));
  const targetDir = resolve(String(kv.get('--target-dir') ?? join(repoRoot, 'apps', 'website', 'public')));

  const result = await syncInstallers({
    sourceDir,
    targetDir,
    checkOnly,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
