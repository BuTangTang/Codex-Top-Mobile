import { describe, expect, it } from 'vitest';

import { getSettingsStackScreenDefinitions } from './settingsRouteRegistry';

describe('settingsRouteRegistry', () => {
    it('gives the phone account tab its own title while retaining nested back navigation', () => {
        const definitions = getSettingsStackScreenDefinitions((key) => key, { phoneMainTab: true });
        const root = definitions.find((entry) => entry.name === 'index')!;
        expect(root.options.headerTitle).toBe('tabs.account');
        expect(root.options.headerBackVisible).toBe(false);
        const machines = definitions.find((entry) => entry.name === 'machines')!;
        expect(machines.options.headerTitle).toBe('tabs.machines');
        expect(machines.options.headerBackVisible).toBe(false);
        expect(definitions.find((entry) => entry.name === 'machines/add')!.options.headerBackVisible).not.toBe(false);
        expect(definitions.find((entry) => entry.name === 'account')!.options.headerBackVisible).not.toBe(false);
        expect(getSettingsStackScreenDefinitions((key) => key).find((entry) => entry.name === 'index')!.options.headerTitle).toBe('settings.title');
    });

    it('registers the actions detail route chrome', () => {
        const definitions = getSettingsStackScreenDefinitions((key) => key);
        const routeNames = definitions.map((definition) => definition.name);

        expect(routeNames).toContain('actions/[actionId]');
    });
});
