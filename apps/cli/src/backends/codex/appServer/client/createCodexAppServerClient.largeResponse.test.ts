import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';

import { createCodexAppServerClient } from './createCodexAppServerClient';
import {
    createCodexAppServerProcessEnv,
    writeFakeCodexAppServerScript,
} from '../testkit/fakeCodexAppServer';

type LargeThreadResponse = Readonly<{
    thread: Readonly<{
        id: string;
        payload: string;
    }>;
}>;

function isLargeThreadResponse(value: unknown): value is LargeThreadResponse {
    if (value === null || typeof value !== 'object' || !('thread' in value)) return false;
    const thread = value.thread;
    return thread !== null
        && typeof thread === 'object'
        && 'id' in thread
        && 'payload' in thread
        && typeof thread.id === 'string'
        && typeof thread.payload === 'string';
}

async function writeInitializingFakeAppServer(params: Readonly<{
    root: string;
    extraBodyLines: readonly string[];
}>): Promise<string> {
    return await writeFakeCodexAppServerScript({
        dir: params.root,
        setupLines: [
            'async function writeChunked(line, chunkSize) {',
            '  for (let offset = 0; offset < line.length; offset += chunkSize) {',
            '    process.stdout.write(line.slice(offset, offset + chunkSize));',
            '    await new Promise((resolve) => setImmediate(resolve));',
            '  }',
            '}',
        ],
        bodyLines: [
            'for await (const line of rl) {',
            '  if (!line.trim()) continue;',
            '  const msg = JSON.parse(line);',
            '  if (msg.method === "initialize") {',
            '    process.stdout.write(JSON.stringify({ id: msg.id, result: { serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");',
            '    continue;',
            '  }',
            '  if (msg.method === "initialized") continue;',
            ...params.extraBodyLines,
            '  process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: "method not found" } }) + "\\n");',
            '}',
        ],
    });
}

describe('createCodexAppServerClient large responses', () => {
    it('resolves a large single-line response that arrives across many stdout chunks', async () => {
        await withTempDir('happier-codex-app-server-client-large-response-', async (root) => {
            const fakeAppServer = await writeInitializingFakeAppServer({
                root,
                extraBodyLines: [
                    'if (msg.method === "thread/resume") {',
                    '  const payload = "x".repeat(16 * 1024 * 1024);',
                    '  const response = JSON.stringify({ id: msg.id, result: { thread: { id: "thread-large", payload } } }) + "\\n";',
                    '  await writeChunked(response, 8 * 1024);',
                    '  continue;',
                    '}',
                ],
            });

            const client = await createCodexAppServerClient({
                processEnv: createCodexAppServerProcessEnv(fakeAppServer, {
                    HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '3000',
                    HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '3000',
                }),
            });

            try {
                const response = await client.request('thread/resume', { threadId: 'thread-large' });
                if (!isLargeThreadResponse(response)) {
                    throw new Error('Expected large thread response');
                }
                expect(response.thread.id).toBe('thread-large');
                expect(response.thread.payload).toHaveLength(16 * 1024 * 1024);
            } finally {
                await client.dispose();
            }
        });
    }, 10_000);

    it('truncates oversized JSON-RPC log payloads without changing the response returned to callers', async () => {
        await withTempDir('happier-codex-app-server-client-large-rpc-log-', async (root) => {
            const requestLogPath = join(root, 'rpc.jsonl');
            const fakeAppServer = await writeInitializingFakeAppServer({
                root,
                extraBodyLines: [
                    'if (msg.method === "state/read") {',
                    '  const longText = "a".repeat(10_000);',
                    '  const items = Array.from({ length: 100 }, (_, index) => ({ index, text: "b".repeat(200) }));',
                    '  process.stdout.write(JSON.stringify({ id: msg.id, result: { longText, items } }) + "\\n");',
                    '  continue;',
                    '}',
                ],
            });

            const client = await createCodexAppServerClient({
                processEnv: createCodexAppServerProcessEnv(fakeAppServer, {
                    HAPPIER_CODEX_APP_SERVER_RPC_LOG_PATH: requestLogPath,
                }),
            });

            try {
                await expect(client.request('state/read')).resolves.toEqual({
                    longText: 'a'.repeat(10_000),
                    items: expect.arrayContaining([expect.objectContaining({ index: 99, text: 'b'.repeat(200) })]),
                });
            } finally {
                await client.dispose();
            }

            const logText = await readFile(requestLogPath, 'utf8');
            expect(logText.length).toBeLessThan(15_000);
            const entries = logText.trim().split('\n').map((line) => JSON.parse(line) as {
                direction: string;
                method?: string;
                result?: { longText?: unknown; items?: unknown };
            });
            const incomingStateRead = entries.find((entry) => entry.direction === 'incoming' && entry.result?.longText);
            expect(incomingStateRead?.result).toMatchObject({
                longText: expect.objectContaining({
                    __happierRpcLogTruncated: true,
                    originalType: 'string',
                    originalLength: 10_000,
                }),
                items: expect.objectContaining({
                    __happierRpcLogTruncated: true,
                    originalType: 'array',
                    totalItems: 100,
                }),
            });
        });
    });

    it('rejects an oversized JSON-RPC line instead of throwing from the stdout parser', async () => {
        await withTempDir('happier-codex-app-server-client-oversized-line-', async (root) => {
            const fakeAppServer = await writeInitializingFakeAppServer({
                root,
                extraBodyLines: [
                    'if (msg.method === "thread/resume") {',
                    '  const payload = "x".repeat(4 * 1024);',
                    '  const response = JSON.stringify({ id: msg.id, result: { thread: { id: "thread-too-large", payload } } }) + "\\n";',
                    '  await writeChunked(response, 512);',
                    '  continue;',
                    '}',
                    'if (msg.method === "state/read") {',
                    '  process.stdout.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + "\\n");',
                    '  continue;',
                    '}',
                ],
            });

            const client = await createCodexAppServerClient({
                processEnv: createCodexAppServerProcessEnv(fakeAppServer, {
                    HAPPIER_CODEX_APP_SERVER_MAX_JSON_LINE_CHARS: '1024',
                    HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '3000',
                    HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '3000',
                }),
            });

            try {
                await expect(client.request('thread/resume', { threadId: 'thread-too-large' }))
                    .rejects
                    .toThrow(/Codex app-server JSON output exceeded 1024 characters/);
                await expect(client.request('state/read')).resolves.toEqual({ ok: true });
            } finally {
                await client.dispose();
            }
        });
    }, 10_000);
});
