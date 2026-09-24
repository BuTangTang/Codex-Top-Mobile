import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('pipeline CLI can prepare TestFlight external distribution for dev in dry-run', () => {
  const out = execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'expo-testflight-distribute',
      '--environment',
      'dev',
      '--build-number',
      '1234',
      '--app-version',
      '1.2.3',
      '--external-groups',
      'Public Beta,QA',
      '--dry-run',
      '--secrets-source',
      'env',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        APPLE_API_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /scripts\/pipeline\/expo\/testflight-distribute\.mjs/);
  assert.match(out, /\[pipeline\] testflight distribute: environment=dev/);
  assert.match(out, /external_groups=Public Beta, QA/);
  assert.match(out, /build_number=1234/);
  assert.match(out, /app_version=1\.2\.3/);
});

test('pipeline CLI accepts external TestFlight group ids in dry-run', () => {
  const out = execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'expo-testflight-distribute',
      '--environment',
      'dev',
      '--build-number',
      '1234',
      '--external-groups',
      '78315e16-c539-43ae-a65e-4f465dccaf68',
      '--dry-run',
      '--secrets-source',
      'env',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        APPLE_API_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /external_groups=78315e16-c539-43ae-a65e-4f465dccaf68/);
});
