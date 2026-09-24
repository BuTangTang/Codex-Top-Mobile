import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View' });
});

vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: Record<string, unknown>) => React.createElement('AgentIcon', props),
}));

vi.mock('@/agents/catalog/catalog', () => ({
    getAgentCore: (agentId: string) => ({
        displayNameKey: `agent.${agentId}`,
        ui: { agentPickerIconName: 'code-slash-outline' },
    }),
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

describe('getAgentDropdownMenuItems', () => {
    it('renders provider icons through the canonical AgentIcon path', async () => {
        const { getAgentDropdownMenuItems } = await import('./agentDropdownItems');
        const [item] = getAgentDropdownMenuItems({
            agentIds: ['cursor' as never],
            iconColor: 'currentColor',
        });

        const frame = item?.icon as React.ReactElement<{ children: React.ReactNode }> | undefined;
        expect(frame?.type).toBe('View');
        const icon = React.Children.only(frame?.props.children) as React.ReactElement<Record<string, unknown>>;
        expect(typeof icon.type === 'function' ? icon.type.name : icon.type).toBe('AgentIcon');
        expect(icon.props).toMatchObject({
            agentId: 'cursor',
            color: 'currentColor',
            size: 22,
        });
    });
});
