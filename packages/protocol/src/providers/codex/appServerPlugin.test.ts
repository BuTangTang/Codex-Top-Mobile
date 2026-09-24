import { describe, expect, it } from 'vitest';

import { normalizeCodexAppServerPluginSummaries } from './appServerPlugin.js';

describe('Codex app-server vendor plugin wire schema', () => {
    it('normalizes mentionable vendor plugin summaries and preserves plugin paths', () => {
        const plugins = normalizeCodexAppServerPluginSummaries([
            {
                id: 'gmail@openai-curated',
                name: 'gmail',
                displayName: 'Gmail',
                description: 'Mail integration',
                path: 'plugin://gmail@openai-curated',
                installed: true,
                enabled: true,
                installPolicy: 'default',
                extra: 'accepted',
            },
            {
                id: 'disabled',
                name: 'disabled',
                path: 'plugin://disabled@local',
                installed: true,
                enabled: false,
            },
        ]);

        expect(plugins).toEqual([
            expect.objectContaining({
                vendorPluginRef: 'plugin://gmail@openai-curated',
                name: 'gmail',
                displayName: 'Gmail',
                description: 'Mail integration',
                installed: true,
                enabled: true,
                mentionable: true,
            }),
            expect.objectContaining({
                vendorPluginRef: 'plugin://disabled@local',
                mentionable: false,
            }),
        ]);
    });
});
