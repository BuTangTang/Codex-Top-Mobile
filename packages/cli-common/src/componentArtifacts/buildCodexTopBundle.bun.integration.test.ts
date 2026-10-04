import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODEX_TOP_ARTIFACT_PROFILE } from './codexTopArtifactProfile.js';
import { fingerprintCodexTopBundle } from './fingerprintCodexTopBundle.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const bun = process.env.HAPPIER_BUN_PATH || '';
const cliDir = join(repoRoot, 'apps/cli');
const target = { bunTarget: 'bun-darwin-arm64', os: 'darwin', arch: 'arm64', exeExt: '' };

// Explicit opt-in uses only a provisioned Bun. No runtime download, account, daemon or network.
describe.skipIf(!bun || !existsSync(bun))('actual product bundle owner', () => {
  it.each([false, true])('runs actual aliases and rejects a lost optional-tool alias: %s', async (breakToolAlias) => {
    const owner = await import(pathToFileURL(join(cliDir, 'scripts/build.mjs')).href);
    const source = await owner.createImmutableBuildSource({ packageRoot: cliDir, buildVersion: '1.0.0+codextop.90' });
    const output = await mkdtemp(join(tmpdir(), 'codextop-bun-bundle-'));
    try {
      const profile = structuredClone(CODEX_TOP_ARTIFACT_PROFILE) as { aliases: Record<string, string> };
      if (breakToolAlias) delete profile.aliases['@/rpc/handlers/sessionToolCapabilities'];
      const profilePath = join(source.packageRoot, 'profile.json');
      const metafilePath = join(source.packageRoot, 'metadata.json');
      const bundleScriptPath = join(cliDir, 'scripts/buildCodexTopBundle.mjs');
      await writeFile(profilePath, JSON.stringify(profile));
      const result = spawnSync(bun, [bundleScriptPath, source.packageRoot, join(output, 'package-dist'), profilePath, metafilePath], {
        cwd: repoRoot, encoding: 'utf8', timeout: 30_000,
      });
      if (breakToolAlias) {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Unexpected non-product dependencies retained');
        expect(result.stderr).toMatch(/difftastic\.ts|ripgrep\.ts/);
        return;
      }
      expect(result.status, result.stderr).toBe(0);
      const meta = JSON.parse(await readFile(metafilePath, 'utf8'));
      const runtime = await readFile(join(output, 'runtime/bun'));
      expect(meta.codexTopBuildRuntime.sha256).toBe(createHash('sha256').update(runtime).digest('hex'));
      expect(meta.codexTopBuildRuntime.bytes).toBe(runtime.length);
      expect((await readFile(bun)).equals(runtime)).toBe(true);
      expect(await fingerprintCodexTopBundle({ repoRoot, sourceRoot: source.packageRoot, metafilePath, profile,
        target, releaseVersion: '1.0.0+codextop.90', bundleScriptPath })).toMatch(/^[a-f0-9]{64}$/);
      const retained = Object.values(meta.outputs).flatMap((out: any) => Object.entries(out.inputs)
        .filter(([, value]: any) => value.bytesInOutput > 0).map(([name]) => name));
      expect(retained.some(name => name.endsWith('/catalogRegistry.codexTop.ts'))).toBe(true);
      expect(retained.some(name => name.endsWith('/profiles/codexTopCapabilities.ts'))).toBe(true);
      expect(retained.some(name => name.endsWith('/catalogRegistry.ts'))).toBe(false);
    } finally {
      await source.cleanup();
      await rm(output, { recursive: true, force: true });
    }
  }, 60_000);
});
