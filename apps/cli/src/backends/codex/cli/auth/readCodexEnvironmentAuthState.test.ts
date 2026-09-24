import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readCodexEnvironmentAuthState,
  readCodexEnvironmentAuthTokens,
} from './readCodexEnvironmentAuthState';

function buildJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('readCodexEnvironmentAuthState', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('ignores expired credentials-file tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-codex-auth-state-'));
    tempDirs.push(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    await writeFile(
      join(dir, '.codex', 'auth.json'),
      JSON.stringify({
        tokens: {
          id_token: buildJwt({ email: 'expired@example.test', exp: 1 }),
        },
      }),
      'utf8',
    );

    expect(readCodexEnvironmentAuthState({ HOME: dir, USERPROFILE: dir })).toEqual({
      method: null,
      accountLabel: null,
    });
  });

  it('accepts unexpired credentials-file tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-codex-auth-state-'));
    tempDirs.push(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    await writeFile(
      join(dir, '.codex', 'auth.json'),
      JSON.stringify({
        tokens: {
          id_token: buildJwt({ email: 'valid@example.test', exp: 4_102_444_800 }),
        },
      }),
      'utf8',
    );

    expect(readCodexEnvironmentAuthState({ HOME: dir, USERPROFILE: dir })).toEqual({
      method: 'credentials_file',
      accountLabel: 'valid@example.test',
    });
  });

  it('reads unexpired Codex auth tokens and ChatGPT account id for provider APIs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-codex-auth-tokens-'));
    tempDirs.push(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    await writeFile(
      join(dir, '.codex', 'auth.json'),
      JSON.stringify({
        tokens: {
          id_token: buildJwt({ email: 'valid@example.test', exp: 4_102_444_800 }),
          access_token: buildJwt({ email: 'valid@example.test', exp: 4_102_444_800 }),
          account_id: 'acct-native',
        },
      }),
      'utf8',
    );

    expect(readCodexEnvironmentAuthTokens({ HOME: dir, USERPROFILE: dir })).toEqual({
      idToken: expect.any(String),
      accessToken: expect.any(String),
      accountId: 'acct-native',
      accountLabel: 'valid@example.test',
    });
  });

  it('accepts CODEX_API_KEY env auth without an auth file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-codex-auth-state-'));
    tempDirs.push(dir);

    expect(readCodexEnvironmentAuthState({
      HOME: dir,
      USERPROFILE: dir,
      CODEX_API_KEY: 'codex-test-key',
    })).toEqual({
      method: 'api_key_env',
      accountLabel: null,
    });
  });

  it('expands ~/ CODEX_HOME against the provided HOME before reading auth.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-codex-auth-state-home-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'scoped-codex-home'), { recursive: true });
    await writeFile(
      join(dir, 'scoped-codex-home', 'auth.json'),
      JSON.stringify({
        tokens: {
          id_token: buildJwt({ email: 'scoped@example.test', exp: 4_102_444_800 }),
        },
      }),
      'utf8',
    );

    expect(readCodexEnvironmentAuthState({
      HOME: dir,
      USERPROFILE: dir,
      CODEX_HOME: '~/scoped-codex-home',
    })).toEqual({
      method: 'credentials_file',
      accountLabel: 'scoped@example.test',
    });
  });
});
