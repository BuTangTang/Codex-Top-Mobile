import { CURSOR_PROVIDER_FIELDS } from '@happier-dev/agents';

import type { ProviderSettingsPlugin } from '@/agents/providers/shared/providerSettingsPlugin';

export const CURSOR_PROVIDER_SETTINGS_PLUGIN: ProviderSettingsPlugin = {
    providerId: 'cursor',
    title: { key: 'settingsProviders.plugins.cursor.title' },
    icon: { ionName: 'code-slash-outline', color: { kind: 'theme', token: 'blue' } },
    settings: CURSOR_PROVIDER_FIELDS,
    uiSections: [
        {
            id: 'cursorCli',
            title: { key: 'settingsProviders.plugins.cursor.sections.cli.title' },
            footer: { key: 'settingsProviders.plugins.cursor.sections.cli.footer' },
            fields: [
                {
                    key: 'cursorBinaryPath',
                    kind: 'text',
                    title: { key: 'settingsProviders.plugins.cursor.fields.cursorBinaryPath.title' },
                    subtitle: { key: 'settingsProviders.plugins.cursor.fields.cursorBinaryPath.subtitle' },
                },
                {
                    key: 'cursorApiEndpoint',
                    kind: 'text',
                    title: { key: 'settingsProviders.plugins.cursor.fields.cursorApiEndpoint.title' },
                    subtitle: { key: 'settingsProviders.plugins.cursor.fields.cursorApiEndpoint.subtitle' },
                },
                {
                    key: 'cursorAgentFallbackEnabled',
                    kind: 'boolean',
                    title: { key: 'settingsProviders.plugins.cursor.fields.cursorAgentFallbackEnabled.title' },
                    subtitle: { key: 'settingsProviders.plugins.cursor.fields.cursorAgentFallbackEnabled.subtitle' },
                },
            ],
        },
    ],
    buildOutgoingMessageMetaExtras: () => ({}),
};
