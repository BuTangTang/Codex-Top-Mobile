import { describe, expect, it, vi } from 'vitest';

import { listCodexAppServerSkills, listCodexVendorPlugins } from './pluginAndSkillCatalog';

describe('pluginAndSkillCatalog', () => {
    it('lists vendor plugins with cwds and normalizes mentionable plugin entries', async () => {
        const client = {
            request: vi.fn(async () => ({
                marketplaces: [
                    {
                        name: 'openai-curated',
                        plugins: [
                            {
                                id: 'gmail@openai-curated',
                                name: 'gmail',
                                interface: { displayName: 'Gmail', shortDescription: 'Read mail' },
                                source: { type: 'remote' },
                                installed: true,
                                enabled: true,
                            },
                            {
                                id: 'gmail@openai-curated-duplicate',
                                name: 'gmail',
                                source: { type: 'remote' },
                                installed: true,
                                enabled: true,
                            },
                            {
                                id: 'disabled',
                                name: 'disabled',
                                source: { type: 'remote' },
                                installed: true,
                                enabled: false,
                            },
                            {
                                id: 'plugin://calendar@openai-curated',
                                name: 'calendar',
                                source: { type: 'remote' },
                                installed: true,
                                enabled: true,
                            },
                        ],
                    },
                ],
            })),
        };

        await expect(listCodexVendorPlugins({ client, cwd: '/repo' })).resolves.toEqual({
            supported: true,
            vendorPlugins: [
                expect.objectContaining({
                    id: 'gmail@openai-curated',
                    name: 'gmail',
                    displayName: 'Gmail',
                    description: 'Read mail',
                    vendorPluginRef: 'plugin://gmail@openai-curated',
                    mentionable: true,
                }),
                expect.objectContaining({
                    id: 'disabled',
                    name: 'disabled',
                    mentionable: false,
                }),
                expect.objectContaining({
                    id: 'plugin://calendar@openai-curated',
                    name: 'calendar',
                    vendorPluginRef: 'plugin://calendar@openai-curated',
                    mentionable: true,
                }),
            ],
        });
        expect(client.request).toHaveBeenCalledWith('plugin/list', { cwds: ['/repo'] });
    });

    it('does not send non-upstream forceReload to plugin/list', async () => {
        const client = {
            request: vi.fn(async (_method: string, _params?: unknown) => ({ marketplaces: [] })),
        };

        await listCodexVendorPlugins({ client, cwd: '/repo' });

        expect(client.request.mock.calls[0]?.[1]).not.toHaveProperty('forceReload');
    });

    it('lists skills with cwds and dedupes by normalized name preferring enabled entries', async () => {
        const client = {
            request: vi.fn(async () => ({
                data: [
                    {
                        cwd: '/repo',
                        skills: [
                            {
                                name: 'Review',
                                description: 'Disabled review',
                                shortDescription: 'Disabled',
                                path: '/disabled/SKILL.md',
                                scope: 'repo',
                                enabled: false,
                            },
                            {
                                name: 'review',
                                description: 'Review code thoroughly',
                                interface: { displayName: 'Code Review', shortDescription: 'Review code' },
                                path: '/enabled/SKILL.md',
                                scope: 'repo',
                                enabled: true,
                            },
                        ],
                        errors: [],
                    },
                ],
            })),
        };

        await expect(listCodexAppServerSkills({ client, cwd: '/repo' })).resolves.toEqual({
            supported: true,
            skills: [
                {
                    name: 'review',
                    displayName: 'Code Review',
                    description: 'Review code',
                    path: '/enabled/SKILL.md',
                    enabled: true,
                    origin: 'codex_native',
                },
            ],
        });
        expect(client.request).toHaveBeenCalledWith('skills/list', { cwds: ['/repo'] });
    });

    it('returns unsupported diagnostics for missing plugin and skill methods', async () => {
        const client = {
            request: vi.fn(async () => {
                const error = new Error('method not found') as Error & { code: number };
                error.code = -32601;
                throw error;
            }),
        };

        await expect(listCodexVendorPlugins({ client, cwd: '/repo' })).resolves.toEqual({
            supported: false,
            vendorPlugins: [],
            diagnostic: expect.stringContaining('method not found'),
        });
        await expect(listCodexAppServerSkills({ client, cwd: '/repo' })).resolves.toEqual({
            supported: false,
            skills: [],
            diagnostic: expect.stringContaining('method not found'),
        });
    });
});
