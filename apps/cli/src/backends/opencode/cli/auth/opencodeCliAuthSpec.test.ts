import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeExecutableShimSync } from '@/testkit/fs/executableShim';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';
import { opencodeCliAuthSpec } from './opencodeCliAuthSpec';

describe('opencodeCliAuthSpec', () => {
  let workDir = '';
  let previousXdgDataHome = '';

  beforeEach(() => {
    workDir = createTempDirSync('happier-opencode-auth-');
    previousXdgDataHome = process.env.XDG_DATA_HOME ?? '';
  });

  afterEach(() => {
    if (previousXdgDataHome) process.env.XDG_DATA_HOME = previousXdgDataHome;
    else delete process.env.XDG_DATA_HOME;
    if (workDir) removeTempDirSync(workDir);
  });

  it.skipIf(process.platform === 'win32')('treats a moderately slow auth list probe as logged in when the command succeeds and the refresh token is valid', async () => {
    const binDir = join(workDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const xdgDataHome = join(workDir, 'xdg-data');
    await mkdir(join(xdgDataHome, 'opencode'), { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    await writeFile(join(xdgDataHome, 'opencode', 'auth.json'), JSON.stringify({
      openai: {
        type: 'oauth',
        refresh: 'refresh',
        access: 'access',
        expires: Date.now() + 60_000,
        accountId: 'acct',
      },
    }), 'utf8');

    const resolvedPath = writeExecutableShimSync({
      dir: binDir,
      fileName: 'opencode',
      contents: [
        '#!/bin/sh',
        'if [ "$1" = "auth" ] && [ "$2" = "list" ]; then',
        '  sleep 2',
        '  echo "OpenAI alice@example.com oauth"',
        '  exit 0',
        'fi',
        'exit 1',
      ].join('\n'),
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const detectAuthStatus = opencodeCliAuthSpec.detectAuthStatus;

    expect(detectAuthStatus).toBeTypeOf('function');

    if (!detectAuthStatus) {
      throw new Error('Expected opencode CLI auth spec to expose detectAuthStatus');
    }

    const result = await detectAuthStatus({ resolvedPath });

    expect(result).toMatchObject({
      state: 'logged_in',
      method: 'oauth_cli',
      source: 'command',
      accountLabel: 'alice@example.com',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 10_000);

  it.skipIf(process.platform === 'win32')('fails closed when auth list succeeds but the refresh token is already invalid', async () => {
    const binDir = join(workDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const xdgDataHome = join(workDir, 'xdg-data');
    await mkdir(join(xdgDataHome, 'opencode'), { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    await writeFile(join(xdgDataHome, 'opencode', 'auth.json'), JSON.stringify({
      openai: {
        type: 'oauth',
        refresh: 'stale-refresh',
        access: 'access',
        expires: Date.now() + 60_000,
        accountId: 'acct',
      },
    }), 'utf8');

    const resolvedPath = writeExecutableShimSync({
      dir: binDir,
      fileName: 'opencode',
      contents: [
        '#!/bin/sh',
        'if [ "$1" = "auth" ] && [ "$2" = "list" ]; then',
        '  echo "OpenAI alice@example.com oauth"',
        '  exit 0',
        'fi',
        'exit 1',
      ].join('\n'),
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid refresh token',
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const detectAuthStatus = opencodeCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');

    if (!detectAuthStatus) {
      throw new Error('Expected opencode CLI auth spec to expose detectAuthStatus');
    }

    const result = await detectAuthStatus({ resolvedPath });

    expect(result).toMatchObject({
      state: 'logged_out',
      reason: 'probe_failed',
      source: 'mixed',
      method: 'oauth_cli',
      accountLabel: 'alice@example.com',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 10_000);

  it.skipIf(process.platform === 'win32')('keeps command-auth as logged in when refresh-token validation fails due to transport error', async () => {
    const binDir = join(workDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const xdgDataHome = join(workDir, 'xdg-data');
    await mkdir(join(xdgDataHome, 'opencode'), { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    await writeFile(join(xdgDataHome, 'opencode', 'auth.json'), JSON.stringify({
      openai: {
        type: 'oauth',
        refresh: 'refresh',
        access: 'access',
        expires: Date.now() + 60_000,
        accountId: 'acct',
      },
    }), 'utf8');

    const resolvedPath = writeExecutableShimSync({
      dir: binDir,
      fileName: 'opencode',
      contents: [
        '#!/bin/sh',
        'if [ "$1" = "auth" ] && [ "$2" = "list" ]; then',
        '  echo "OpenAI alice@example.com oauth"',
        '  exit 0',
        'fi',
        'exit 1',
      ].join('\n'),
    });
    const fetchMock = vi.fn(async () => {
      throw new TypeError('network down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const detectAuthStatus = opencodeCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');

    if (!detectAuthStatus) {
      throw new Error('Expected opencode CLI auth spec to expose detectAuthStatus');
    }

    const result = await detectAuthStatus({ resolvedPath });

    expect(result).toMatchObject({
      state: 'logged_in',
      method: 'oauth_cli',
      source: 'command',
      accountLabel: 'alice@example.com',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 10_000);
});
