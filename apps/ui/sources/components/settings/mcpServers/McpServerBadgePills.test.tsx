import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';

describe('McpServerBadgePills', () => {
    it('renders semantic badge tones through the shared status pill', async () => {
        const { McpServerBadgePills } = await import('./McpServerBadgePills');

        const screen = await renderScreen(
            <McpServerBadgePills
                testID="mcp-badges"
                badges={[
                    { key: 'connected', label: 'Connected', tone: 'success' },
                    { key: 'limited', label: 'Limited', tone: 'warning' },
                    { key: 'scoped', label: 'Scoped', tone: 'accent' },
                    { key: 'default', label: 'Default' },
                ]}
            />,
        );

        expect(screen.findByTestId('mcp-badges:connected:variant:success')).toBeTruthy();
        expect(screen.findByTestId('mcp-badges:limited:variant:warning')).toBeTruthy();
        expect(screen.findByTestId('mcp-badges:scoped:variant:info')).toBeTruthy();
        expect(screen.findByTestId('mcp-badges:default:variant:neutral')).toBeTruthy();
    });
});
