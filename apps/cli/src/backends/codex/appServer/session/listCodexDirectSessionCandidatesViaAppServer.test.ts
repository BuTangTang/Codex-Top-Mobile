import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';

import { listCodexDirectSessionCandidatesViaAppServer } from './listCodexDirectSessionCandidatesViaAppServer';
import {
    createCodexAppServerTestEnvScope,
    writeFakeCodexAppServerScript,
    writeFakeCodexAppServerThreadListScript,
} from '../testkit/fakeCodexAppServer';

describe('listCodexDirectSessionCandidatesViaAppServer', () => {
    it('explicitly disables rollout repair on every live and archived page', async () => {
        await withTempDir('codex-thread-list-read-only-', async (root) => {
            const requestsFile = join(root, 'thread-list-requests.jsonl');
            // 在真实 JSON-RPC 子进程边界收集四次分页请求，任何一页漏传只读标记都会失败。
            const bin = await writeFakeCodexAppServerScript({
                dir: root,
                importLines: ['import { appendFile } from "node:fs/promises";'],
                setupLines: [`const requestsFile = ${JSON.stringify(requestsFile)};`],
                bodyLines: [
                    'for await (const line of rl) {',
                    '  if (!line.trim()) continue;',
                    '  const msg = JSON.parse(line);',
                    '  if (msg.method === "initialize") {',
                    '    process.stdout.write(JSON.stringify({ id: msg.id, result: { serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");',
                    '    continue;',
                    '  }',
                    '  if (msg.method === "initialized") continue;',
                    '  if (msg.method === "thread/list") {',
                    '    await appendFile(requestsFile, JSON.stringify(msg.params) + "\\n", "utf8");',
                    '    const kind = msg.params.archived ? "archived" : "live";',
                    '    const page = msg.params.cursor === `${kind}-next` ? 2 : 1;',
                    '    const result = { data: [{ id: `${kind}-${page}`, source: "appServer" }], nextCursor: page === 1 ? `${kind}-next` : null };',
                    '    process.stdout.write(JSON.stringify({ id: msg.id, result }) + "\\n");',
                    '    continue;',
                    '  }',
                    '  process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: "method not found" } }) + "\\n");',
                    '}',
                ],
            });
            const result = await listCodexDirectSessionCandidatesViaAppServer({
                codexHome: join(root, 'codex-home'), env: {
                    HAPPIER_CODEX_APP_SERVER_BIN: bin, HAPPIER_CODEX_APP_SERVER_THREAD_LIST_PAGE_SIZE: '200',
                },
            });
            expect(result.map((candidate) => candidate.remoteSessionId)).toEqual(['live-1', 'live-2', 'archived-1', 'archived-2']);
            const requests = (await readFile(requestsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
            expect(requests).toHaveLength(4);
            for (const archived of [false, true]) {
                expect(requests.filter((request) => request.archived === archived)).toEqual([
                    { limit: 200, sortKey: 'updated_at', archived, useStateDbOnly: true },
                    { limit: 200, sortKey: 'updated_at', archived, useStateDbOnly: true, cursor: `${archived ? 'archived' : 'live'}-next` },
                ]);
            }
        });
    });

    it('filters explicit subagent sources and cleans previews while preserving official names and unknown sources', async () => {
        await withTempDir('codex-app-server-source-title-', async (root) => {
            const bin = await writeFakeCodexAppServerThreadListScript({ dir: root, nonArchivedThreads: [
                // Codex 原生 v2 ThreadListResponse：SessionSource.subAgent 与 Thread.threadSource。
                { id: 'child', source: { subAgent: { thread_spawn: { parent_thread_id: 'parent', depth: 1 } } }, name: 'Normal looking name' },
                { id: 'classified-child', source: 'unknown', threadSource: 'subagent', name: 'Another normal name' },
                { id: 'review-child', source: { subAgent: 'review' }, name: 'A third ordinary name' },
                { id: 'named', name: 'Investigate subagent behavior', source: 'appServer', preview: '<codex_internal_context>noise</codex_internal_context>' },
                { id: 'preview', preview: '<codex_internal_context>noise</codex_internal_context>\n<in-app-browser-context>browser</in-app-browser-context>\nActual request' },
                { id: 'truncated', preview: '<in-app-browser-context>hidden incomplete preview' },
                { id: 'unknown', source: 'future_source', preview: 'Keep ordinary task' },
                { id: 'component', source: { custom: 'widget-editor' }, preview: '修复 <app-context-menu> 的点击处理' },
            ], archivedThreads: [{ id: 'archived-child', threadSource: 'subagent' }] });
            const result = await listCodexDirectSessionCandidatesViaAppServer({ codexHome: root, env: { HAPPIER_CODEX_APP_SERVER_BIN: bin } });
            expect(result.map((entry) => [entry.remoteSessionId, entry.title])).toEqual([
                ['named', 'Investigate subagent behavior'], ['preview', 'Actual request'], ['truncated', undefined], ['unknown', 'Keep ordinary task'],
                ['component', '修复 <app-context-menu> 的点击处理'],
            ]);
        });
    });

    it('reads the thread list page size from params.env instead of global process.env', async () => {
        await withTempDir('happier-codex-direct-app-server-page-size-', async (root) => {
            const limitsFile = join(root, 'thread-list-limits.log');
            const fakeAppServer = await writeFakeCodexAppServerScript({
                dir: root,
                importLines: ['import { appendFile } from "node:fs/promises";'],
                setupLines: [`const limitsFile = ${JSON.stringify(limitsFile)};`],
                bodyLines: [
                    'for await (const line of rl) {',
                    '  if (!line.trim()) continue;',
                    '  const msg = JSON.parse(line);',
                    '  if (msg.method === "initialize") {',
                    '    process.stdout.write(JSON.stringify({ id: msg.id, result: { serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");',
                    '    continue;',
                    '  }',
                    '  if (msg.method === "initialized") continue;',
                    '  if (msg.method === "thread/list") {',
                    '    await appendFile(limitsFile, `${String(msg.params?.limit ?? "")}:${String(msg.params?.archived === true)}\\n`, "utf8");',
                    '    process.stdout.write(JSON.stringify({ id: msg.id, result: { data: [], nextCursor: null } }) + "\\n");',
                    '    continue;',
                    '  }',
                    '  process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: "method not found" } }) + "\\n");',
                    '}',
                ],
            });

            const envScope = createCodexAppServerTestEnvScope();
            envScope.patch({ HAPPIER_CODEX_APP_SERVER_THREAD_LIST_PAGE_SIZE: '11' });

            try {
                await listCodexDirectSessionCandidatesViaAppServer({
                    codexHome: join(root, 'codex-home'),
                    env: {
                        HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer,
                        HAPPIER_CODEX_APP_SERVER_THREAD_LIST_PAGE_SIZE: '7',
                    },
                });
            } finally {
                envScope.restore();
            }

            const loggedLimits = await readFile(limitsFile, 'utf8');
            expect(loggedLimits.trim().split('\n').sort()).toEqual(['7:false', '7:true']);
        });
    });

    it('emits canonical agentRuntimeDescriptorV1 for app-server thread candidates', async () => {
        await withTempDir('happier-codex-direct-app-server-runtime-descriptor-', async (root) => {
            const fakeAppServer = await writeFakeCodexAppServerScript({
                dir: root,
                fileName: 'fake-codex-app-server-runtime.mjs',
                setupLines: [
                    'const threads = [{ id: "thread-1", name: "Thread One", cwd: "/repo/thread-one", updatedAt: 1736000100 }];',
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
                    '  if (msg.method === "thread/list") {',
                    '    process.stdout.write(JSON.stringify({ id: msg.id, result: { data: threads, nextCursor: null } }) + "\\n");',
                    '    continue;',
                    '  }',
                    '  process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: "method not found" } }) + "\\n");',
                    '}',
                ],
            });

            const result = await listCodexDirectSessionCandidatesViaAppServer({
                codexHome: join(root, 'codex-home'),
                env: {
                    HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer,
                },
            });

            expect(result).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    remoteSessionId: 'thread-1',
                    details: expect.objectContaining({
                        agentRuntimeDescriptorV1: expect.objectContaining({
                            v: 1,
                            providerId: 'codex',
                            provider: expect.objectContaining({
                                backendMode: 'appServer',
                                vendorSessionId: 'thread-1',
                                providerExtra: expect.objectContaining({
                                    v: 1,
                                    runtimeAffinity: {
                                        backendMode: 'appServer',
                                        vendorSessionId: 'thread-1',
                                    },
                                }),
                            }),
                        }),
                        runtimeDescriptor: expect.objectContaining({
                            v: 1,
                            providerId: 'codex',
                            provider: expect.objectContaining({
                                backendMode: 'appServer',
                                vendorSessionId: 'thread-1',
                                providerExtra: expect.objectContaining({
                                    v: 1,
                                    runtimeAffinity: {
                                        backendMode: 'appServer',
                                        vendorSessionId: 'thread-1',
                                    },
                                }),
                            }),
                        }),
                        codexBackendMode: 'appServer',
                    }),
                }),
            ]));
        });
    });
});
