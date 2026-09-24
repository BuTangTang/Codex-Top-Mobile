import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { parseEasJsonCommandOutput } from './parse-eas-json-command-output.mjs';

function toDataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function runNode(args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr });
    });
  });
}

test('parseEasJsonCommandOutput prefers the authoritative trailing EAS payload over earlier valid JSON noise', () => {
  const parsed = parseEasJsonCommandOutput(
    [
      'note {"kind":"noise","status":"ignore"}',
      JSON.stringify([
        {
          id: 'build-existing',
          status: 'IN_QUEUE',
          platform: 'ios',
        },
      ]),
    ].join('\n'),
    'eas build:list',
  );

  assert.deepEqual(parsed, [
    {
      id: 'build-existing',
      status: 'IN_QUEUE',
      platform: 'ios',
    },
  ]);
});

test('native-build accepts noisy pretty-printed JSON from eas build:list --fingerprint-hash', async (t) => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..');
  const tmp = await mkdtemp(path.join(tmpdir(), 'native-build-json-output-'));
  t.after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const outPath = path.join(tmp, 'build-output.json');
  const markerPath = path.join(tmp, 'child-process.calls.jsonl');
  const loaderPath = path.join(tmp, 'loader.mjs');
  const registerPath = path.join(tmp, 'register-loader.mjs');
  await writeFile(markerPath, '', 'utf8');

  const buildListPayload = [
    {
      id: 'build-existing',
      status: 'IN_QUEUE',
      platform: 'ios',
      fingerprint: { hash: 'fp-same' },
      createdAt: '2026-05-17T12:34:56.000Z',
    },
  ];

  const stubBySpecifier = {
    'node:child_process': toDataUrl(`
import { appendFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

function log(call) {
  const markerPath = process.env.HAPPIER_NATIVE_BUILD_MARKER;
  if (!markerPath) return;
  appendFileSync(markerPath, JSON.stringify(call) + '\\n', 'utf8');
}

function createChild(stdoutText, stderrText = '') {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    if (stdoutText) child.stdout.write(stdoutText);
    child.stdout.end();
    if (stderrText) child.stderr.write(stderrText);
    child.stderr.end();
    child.emit('close', 0, null);
    child.emit('exit', 0, null);
  });
  return child;
}

export function execFileSync(cmd, args, options = {}) {
  log({ kind: 'execFileSync', cmd, args, cwd: options.cwd ?? null });
  if (cmd === 'npx' && args.includes('build:list') && args.includes('--fingerprint-hash')) {
    return [
      'Resolving matching builds...',
      JSON.stringify(${JSON.stringify(buildListPayload)}, null, 2),
      '',
    ].join('\\n');
  }
  throw new Error(\`Unexpected execFileSync call: \${cmd} \${args.join(' ')}\`);
}

export function spawn(cmd, args, options = {}) {
  log({ kind: 'spawn', cmd, args, cwd: options.cwd ?? null });
  if (cmd === 'npx' && args.includes('fingerprint:generate')) {
    return createChild(JSON.stringify({ hash: 'fp-same', sources: [] }));
  }
  throw new Error(\`Unexpected spawn call: \${cmd} \${args.join(' ')}\`);
}
`),
  };

  const loaderSource = `
const stubBySpecifier = ${JSON.stringify(stubBySpecifier)};
export async function resolve(specifier, context, defaultResolve) {
  const stub = stubBySpecifier[specifier];
  if (stub) return { url: stub, shortCircuit: true };
  return defaultResolve(specifier, context, defaultResolve);
}
`;
  await writeFile(loaderPath, loaderSource, 'utf8');
  await writeFile(
    registerPath,
    [
      `import { register } from 'node:module';`,
      `register(${JSON.stringify(pathToFileURL(loaderPath).href)}, import.meta.url);`,
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(registerPath, 0o644);

  const result = await runNode(
    [
      '--import',
      registerPath,
      path.join(repoRoot, 'scripts', 'pipeline', 'expo', 'native-build.mjs'),
      '--platform',
      'ios',
      '--profile',
      'internalpreview',
      '--out',
      outPath,
      '--build-mode',
      'cloud',
      '--fingerprint-mode',
      'if-changed',
      '--wait',
      'false',
      '--dump-view',
      'false',
      '--eas-cli-version',
      'test',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: '1',
        EXPO_TOKEN: 'test-expo-token',
        HAPPIER_NATIVE_BUILD_MARKER: markerPath,
      },
    },
  );

  assert.equal(result.code, 0, `expected exit 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const out = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'fingerprint unchanged (no native build needed)');
});
