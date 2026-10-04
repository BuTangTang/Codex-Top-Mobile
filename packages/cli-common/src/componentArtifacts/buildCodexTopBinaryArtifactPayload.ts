import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import cliDistBuildManifest from '../../cliDistBuildManifest.cjs';
import { bundleWorkspacePackageWithRuntimeDependencies, resolveWorkspaceBundlesFromPackageJson } from '../workspaces/index.js';
import { assertCodexTopArtifactTarget, CODEX_TOP_ARTIFACT_PROFILE } from './codexTopArtifactProfile.js';
import { copyCodexTopRuntimeAssets } from './copyCodexTopRuntimeAssets.js';
import { ensureFileExists, type RunCommand } from './commands.js';
import { ensureBundledWorkspacePackagesBuilt, type EnsureWorkspacePackagesBuiltByName } from './ensureBundledWorkspacePackagesBuilt.js';
import { finalizeRuntimeArtifactPayload } from './finalizeRuntimeArtifactPayload.js';
import { fingerprintCodexTopBundle } from './fingerprintCodexTopBundle.js';
import { recordCliBinaryArtifactRuntimeAssetBuildManifest } from './refreshCliBinaryArtifactRuntimeAssetBuildManifest.js';
import { resolveExecutableName, type BinaryTarget } from './targets.js';
import { withCliDistBuildLock } from './withCliDistBuildLock.js';

/** Publish only a complete generation; build failures leave the previous payload untouched. */
export async function publishCodexTopPayload(stagingDir: string, payloadDir: string): Promise<void> {
  const backup = await mkdtemp(join(dirname(payloadDir), '.codextop-publish-backup-'));
  await rm(backup, { recursive: true });
  let movedPrevious = false;
  try {
    if (existsSync(payloadDir)) {
      await rename(payloadDir, backup);
      movedPrevious = true;
    }
    await rename(stagingDir, payloadDir);
  } catch (error) {
    if (movedPrevious) await rename(backup, payloadDir);
    throw error;
  }
  if (movedPrevious) await rm(backup, { recursive: true });
}

export async function buildCodexTopBinaryArtifactPayload(params: Readonly<{
  repoRoot: string;
  payloadDir: string;
  target: BinaryTarget;
  releaseVersion: string;
  bunCommand: string;
  runCommand: RunCommand;
  ensureWorkspacePackagesBuiltByName?: EnsureWorkspacePackagesBuiltByName;
}>): Promise<{ executableName: string; entrypoint: string }> {
  assertCodexTopArtifactTarget(params.target);
  const { repoRoot, payloadDir, target, releaseVersion, bunCommand, runCommand } = params;
  const cliDir = join(repoRoot, 'apps/cli');
  const executableName = resolveExecutableName({ baseName: 'happier', target });
  await mkdir(dirname(payloadDir), { recursive: true });
  const stagingDir = await mkdtemp(join(dirname(payloadDir), '.codextop-payload-'));
  try {
    await withCliDistBuildLock(async ({ heldLockValue }) => {
      const bundles = resolveWorkspaceBundlesFromPackageJson({ repoRoot, hostPackageDir: cliDir });
      await ensureBundledWorkspacePackagesBuilt({ repoRoot, bundles, ensureWorkspacePackagesBuiltByName: params.ensureWorkspacePackagesBuiltByName });
      for (const { packageName, srcDir } of bundles) {
        bundleWorkspacePackageWithRuntimeDependencies({ packageName, srcDir, destDir: join(cliDir, 'node_modules', ...packageName.split('/')) });
      }
      const owner = await import(pathToFileURL(join(cliDir, 'scripts/build.mjs')).href) as {
        createImmutableBuildSource: (params: { packageRoot: string; buildVersion: string }) => Promise<{ packageRoot: string; cleanup(): Promise<void> }>;
      };
      const source = await owner.createImmutableBuildSource({ packageRoot: cliDir, buildVersion: releaseVersion });
      try {
        const metadataPath = join(source.packageRoot, 'product-metafile.json');
        const profilePath = join(source.packageRoot, 'product-profile.json');
        await writeFile(profilePath, JSON.stringify(CODEX_TOP_ARTIFACT_PROFILE));
        const bundleScript = join(cliDir, 'scripts/buildCodexTopBundle.mjs');
        const packageDist = join(stagingDir, 'package-dist');
        await runCommand(bunCommand, [bundleScript, source.packageRoot, packageDist, profilePath, metadataPath], {
          cwd: repoRoot,
          env: { ...process.env, HAPPIER_WORKSPACE_DIST_BUILD_LOCK_HELD: heldLockValue },
        });
        const entrypoint = join(packageDist, 'index.mjs');
        await ensureFileExists(entrypoint);
        await ensureFileExists(join(stagingDir, 'runtime/bun'));
        const inputFingerprint = await fingerprintCodexTopBundle({ repoRoot, sourceRoot: source.packageRoot,
          metafilePath: metadataPath, profile: CODEX_TOP_ARTIFACT_PROFILE, target, releaseVersion, bundleScriptPath: bundleScript });
        // Absolute self-relative exec preserves argv, stdin, cancellation PID and caller cwd.
        await writeFile(join(stagingDir, executableName), '#!/bin/sh\nset -eu\nbasedir=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd -P)\nexec "$basedir/runtime/bun" "$basedir/package-dist/index.mjs" "$@"\n');
        await chmod(join(stagingDir, executableName), 0o755);
        await copyCodexTopRuntimeAssets({ repoRoot, payloadDir: stagingDir, metafilePath: metadataPath });
        await writeFile(join(stagingDir, 'product-profile.json'), JSON.stringify({
          id: CODEX_TOP_ARTIFACT_PROFILE.id, revision: CODEX_TOP_ARTIFACT_PROFILE.revision,
          target, buildVersion: releaseVersion, inputFingerprint,
        }, null, 2) + '\n');
        cliDistBuildManifest.writeCliDistBuildManifest(entrypoint, { buildVersion: releaseVersion, inputFingerprint });
        await finalizeRuntimeArtifactPayload(stagingDir);
        recordCliBinaryArtifactRuntimeAssetBuildManifest({ payloadDir: stagingDir, relativePath: 'runtime/bun' });
      } finally { await source.cleanup(); }
      // Publication belongs to this generation's lock just like its immutable build.
      await publishCodexTopPayload(stagingDir, payloadDir);
    }, { lockPath: join(repoRoot, '.project/tmp/cli-dist-build.lock') });
  } finally { await rm(stagingDir, { recursive: true, force: true }); }
  return { executableName, entrypoint: executableName };
}
