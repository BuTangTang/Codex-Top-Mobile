import { execFileSync, spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { withTempPathBin } from '../fs/withTempPathBin';

import { installFakeSecurityCli } from './fakeSecurityCli';

describe('testkit process fakeSecurityCli', () => {
  it('stores, reads, and deletes macOS security generic passwords through the temp PATH bin', async () => {
    await withTempPathBin({ prefix: 'happier-fake-security-' }, async (tempPathBin) => {
      await installFakeSecurityCli(tempPathBin);

      const writePayload = JSON.stringify({
        claudeAiOauth: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      });
      const writeResult = spawnSync(
        'security',
        ['add-generic-password', '-U', '-a', 'leeroy', '-s', 'Claude Code-credentials-fake', '-w'],
        {
          env: tempPathBin.env,
          encoding: 'utf8',
          input: `${writePayload}\n${writePayload}\n`,
        },
      );

      expect(writeResult.status).toBe(0);
      expect(writeResult.stderr).toBe('');

      expect(
        execFileSync(
          'security',
          ['find-generic-password', '-s', 'Claude Code-credentials-fake', '-w'],
          { env: tempPathBin.env, encoding: 'utf8' },
        ).trim(),
      ).toBe(writePayload);

      const deleteResult = spawnSync(
        'security',
        ['delete-generic-password', '-s', 'Claude Code-credentials-fake'],
        { env: tempPathBin.env, encoding: 'utf8' },
      );
      expect(deleteResult.status).toBe(0);

      const missingRead = spawnSync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials-fake', '-w'],
        { env: tempPathBin.env, encoding: 'utf8' },
      );
      expect(missingRead.status).not.toBe(0);
    });
  });
});
