import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getPublicServerUrlEnvOverride } from './urls.mjs';

test('getPublicServerUrlEnvOverride prefers HAPPIER_PUBLIC_SERVER_URL over HAPPIER_STACK_SERVER_URL when both are stack-local', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-server-urls-'));
  const envPath = join(dir, 'stack.env');
  await writeFile(
    envPath,
    [
      'HAPPIER_PUBLIC_SERVER_URL=https://public.stack.example.test',
      'HAPPIER_STACK_SERVER_URL=http://127.0.0.1:3005',
    ].join('\n'),
    'utf-8'
  );

  const out = getPublicServerUrlEnvOverride({
    env: {
      HAPPIER_STACK_STACK: 'dev-built',
      HAPPIER_STACK_ENV_FILE: envPath,
      HAPPIER_PUBLIC_SERVER_URL: 'https://public.stack.example.test',
      HAPPIER_STACK_SERVER_URL: 'http://127.0.0.1:3005',
    },
    serverPort: 3005,
  });

  assert.equal(out.envPublicUrl, 'https://public.stack.example.test');
  assert.equal(out.publicServerUrl, 'https://public.stack.example.test');
});

test('getPublicServerUrlEnvOverride falls back to HAPPIER_STACK_SERVER_URL when no public URL is set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-server-urls-'));
  const envPath = join(dir, 'stack.env');
  await writeFile(envPath, 'HAPPIER_STACK_SERVER_URL=https://stack-share.example.test\n', 'utf-8');

  const out = getPublicServerUrlEnvOverride({
    env: {
      HAPPIER_STACK_STACK: 'dev-built',
      HAPPIER_STACK_ENV_FILE: envPath,
      HAPPIER_STACK_SERVER_URL: 'https://stack-share.example.test',
    },
    serverPort: 3005,
  });

  assert.equal(out.envPublicUrl, 'https://stack-share.example.test');
  assert.equal(out.publicServerUrl, 'https://stack-share.example.test');
});

test('getPublicServerUrlEnvOverride expands ~/ explicit env file overrides against HOME', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-server-urls-'));
  const homeDir = join(dir, 'home');
  const envPath = join(homeDir, '.happier', 'stacks', 'dev', 'env');
  await mkdir(join(homeDir, '.happier', 'stacks', 'dev'), { recursive: true });
  await writeFile(envPath, 'HAPPIER_STACK_SERVER_URL=https://stack-share.example.test\n', 'utf-8');

  const out = getPublicServerUrlEnvOverride({
    env: {
      HOME: homeDir,
      HAPPIER_STACK_STACK: 'dev',
      HAPPIER_STACK_ENV_FILE: '~/.happier/stacks/dev/env',
      HAPPIER_STACK_SERVER_URL: 'https://stack-share.example.test',
    },
    serverPort: 3005,
  });

  assert.equal(out.envPublicUrl, 'https://stack-share.example.test');
  assert.equal(out.publicServerUrl, 'https://stack-share.example.test');
});
