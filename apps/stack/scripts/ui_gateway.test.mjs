import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, 'ui_gateway.mjs');

async function listenServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test server');
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function reservePort() {
  const holder = await listenServer((_req, res) => {
    res.statusCode = 500;
    res.end('reserved');
  });
  const { port } = holder;
  await holder.close();
  return port;
}

async function startGateway({ backendUrl, port }) {
  const child = spawn(process.execPath, [
    scriptPath,
    `--port=${port}`,
    `--backend-url=${backendUrl}`,
    '--minio-port=9',
    '--bucket=test-bucket',
    '--no-ui',
  ], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code, signal]) => {
      throw new Error(`ui_gateway exited before ready (code=${code}, signal=${signal}) stderr=${stderr.join('')}`);
    }),
  ]);

  return {
    child,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await once(child, 'exit');
    },
    stdout,
    stderr,
  };
}

test('ui_gateway proxies /ready and /v2 routes to the backend', async () => {
  const requests = [];
  const backend = await listenServer((req, res) => {
    requests.push(req.url ?? '/');
    if (req.url === '/ready') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', service: 'happier-server' }));
      return;
    }
    if (req.url === '/v2/sessions?limit=1') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ sessions: [{ id: 'ses_1' }] }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  const gatewayPort = await reservePort();
  const gateway = await startGateway({ backendUrl: backend.url, port: gatewayPort });
  try {
    const readyResponse = await fetch(`http://127.0.0.1:${gatewayPort}/ready`);
    assert.equal(readyResponse.status, 200);
    assert.deepEqual(await readyResponse.json(), { status: 'ok', service: 'happier-server' });

    const v2Response = await fetch(`http://127.0.0.1:${gatewayPort}/v2/sessions?limit=1`);
    assert.equal(v2Response.status, 200);
    assert.deepEqual(await v2Response.json(), { sessions: [{ id: 'ses_1' }] });

    assert.deepEqual(requests, ['/ready', '/v2/sessions?limit=1']);
  } finally {
    await Promise.all([
      gateway.stop(),
      backend.close(),
    ]);
  }
});
