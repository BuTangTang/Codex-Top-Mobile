import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';

import {
    createCodexAppServerProcessEnv,
    writeFakeCodexAppServerScript,
} from '../testkit/fakeCodexAppServer';

async function importCatalogControlModule(): Promise<{
    createCodexAppServerCatalogControlAdapter?: unknown;
}> {
    return await import('./codexAppServerCatalogControlAdapter').catch(() => ({}));
}

async function writeCatalogControlFakeAppServer(params: Readonly<{
    dir: string;
    requestLogPath: string;
}>): Promise<string> {
    return await writeFakeCodexAppServerScript({
        dir: params.dir,
        importLines: ['import { appendFileSync } from "node:fs";'],
        setupLines: [
            `const requestLogPath = ${JSON.stringify(params.requestLogPath)};`,
        ],
        bodyLines: [
            'for await (const line of rl) {',
            '  if (!line.trim()) continue;',
            '  const msg = JSON.parse(line);',
            '  appendFileSync(requestLogPath, JSON.stringify({ method: msg.method, params: msg.params ?? null }) + "\\n");',
            '  if (msg.method === "initialize") {',
            '    process.stdout.write(JSON.stringify({ id: msg.id, result: { serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");',
            '    continue;',
            '  }',
            '  if (msg.method === "initialized") continue;',
            '  if (msg.method === "plugin/list") {',
            '    process.stdout.write(JSON.stringify({ id: msg.id, result: { marketplaces: [{ name: "openai-curated", path: null, interface: null, plugins: [{ id: "gmail@openai-curated", name: "gmail", source: { type: "remote" }, interface: { displayName: "Gmail", shortDescription: "Read mail" }, installed: true, enabled: true }] }] } }) + "\\n");',
            '    continue;',
            '  }',
            '  if (msg.method === "skills/list") {',
            '    process.stdout.write(JSON.stringify({ id: msg.id, result: { data: [{ cwd: msg.params?.cwds?.[0] ?? null, skills: [{ name: "review", path: "/repo/.agents/skills/review/SKILL.md", description: "Review code", interface: { displayName: "Review", shortDescription: "Review code" }, scope: "repo", enabled: true }], errors: [] }] } }) + "\\n");',
            '    continue;',
            '  }',
            '  process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: "method not found" } }) + "\\n");',
            '}',
        ],
    });
}

async function readRequests(path: string): Promise<Array<{ method: string; params: Record<string, unknown> | null }>> {
    const text = await readFile(path, 'utf8');
    return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function createAdapter(): Promise<{
    listVendorPlugins: (params: Record<string, unknown>) => Promise<unknown>;
    listSkills: (params: Record<string, unknown>) => Promise<unknown>;
}> {
    const module = await importCatalogControlModule();
    expect(module.createCodexAppServerCatalogControlAdapter).toBeTypeOf('function');
    return (module.createCodexAppServerCatalogControlAdapter as () => {
        listVendorPlugins: (params: Record<string, unknown>) => Promise<unknown>;
        listSkills: (params: Record<string, unknown>) => Promise<unknown>;
    })();
}

describe('codexAppServerCatalogControlAdapter', () => {
    it('lists inactive Codex app-server vendor plugins and skills without resuming or starting a turn', async () => {
        await withTempDir('happier-codex-catalog-control-', async (root) => {
            const requestLogPath = join(root, 'requests.jsonl');
            const fakeAppServer = await writeCatalogControlFakeAppServer({ dir: root, requestLogPath });
            const adapter = await createAdapter();
            const metadata = {
                codexBackendMode: 'appServer',
                agentRuntimeDescriptorV1: {
                    v: 1,
                    providerId: 'codex',
                    provider: {
                        backendMode: 'appServer',
                        vendorSessionId: 'thread-1',
                    },
                },
            };

            await expect(adapter.listVendorPlugins({
                cwd: root,
                metadata,
                processEnv: createCodexAppServerProcessEnv(fakeAppServer),
            })).resolves.toMatchObject({
                supported: true,
                vendorPlugins: [
                    expect.objectContaining({
                        vendorPluginRef: 'plugin://gmail@openai-curated',
                        mentionable: true,
                    }),
                ],
            });
            await expect(adapter.listSkills({
                cwd: root,
                metadata,
                processEnv: createCodexAppServerProcessEnv(fakeAppServer),
            })).resolves.toMatchObject({
                supported: true,
                skills: [
                    expect.objectContaining({
                        name: 'review',
                        path: '/repo/.agents/skills/review/SKILL.md',
                        origin: 'codex_native',
                    }),
                ],
            });

            expect(await readRequests(requestLogPath)).toEqual(expect.arrayContaining([
                expect.objectContaining({ method: 'plugin/list', params: { cwds: [root] } }),
                expect.objectContaining({ method: 'skills/list', params: { cwds: [root] } }),
            ]));
            expect((await readRequests(requestLogPath)).map((request) => request.method)).not.toEqual(expect.arrayContaining([
                'thread/resume',
                'turn/start',
                'turn/steer',
            ]));
        });
    });
});
