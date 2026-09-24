import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { createToolCallMessageFixture, renderScreen, renderToolCallsGroupView, standardCleanup } from '@/dev/testkit';
import { installToolShellCommonModuleMocks } from '@/components/tools/shell/views/ToolView.testHelpers';

// 仅替换平台与存储边界，工具行、权限展示判断和审批按钮均走真实组件。
installToolShellCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key: string) => key });
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
            useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
        });
    },
    storage: async () => {
        const { createStorageModuleStub, createUseSettingMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: createUseSettingMock({ values: {
                permissionPromptSurface: 'transcript',
                toolViewTimelineChromeMode: 'activity_feed',
                toolViewTimelineFeedDefaultExpanded: false,
                transcriptMotionPreset: 'off',
            } }),
        });
    },
});

afterEach(standardCleanup);

describe('phone compact group permission entry', () => {
    // 虚拟列表工具行复用同一个真实审批组件，不要求先展开工具组。
    it('renders the existing approval buttons in a collapsed virtual tool row', async () => {
        const { ToolCallsGroupUnitToolRow } = await import('../../toolCalls/units/ToolCallsGroupUnitToolRow');
        const pending = createToolCallMessageFixture({ id: 'pending', createdAt: 1 });
        pending.tool = { ...pending.tool, name: 'Bash', input: { command: 'pwd' }, permission: { id: 'p1', status: 'pending' } };
        const screen = await renderScreen(<ToolCallsGroupUnitToolRow
            message={pending}
            expanded={false}
            sessionId="s1"
            groupId="g1"
            metadata={null}
            interaction={{ canSendMessages: true, canApprovePermissions: true }}
        />);
        expect(screen.findByTestId('permission-footer.allow')).not.toBeNull();
        expect(screen.findByTestId('permission-footer.deny')).not.toBeNull();
        expect(screen.findByTestId('transcript-anchor-tool-call-pending')).not.toBeNull();
    });

    it('renders the existing approval buttons directly in transcript mode', async () => {
        const pending = createToolCallMessageFixture({ id: 'pending', createdAt: 1 });
        pending.tool = {
            ...pending.tool,
            id: 'call-pending',
            name: 'Bash',
            state: 'running',
            input: { command: 'pwd' },
            permission: { id: 'permission-1', kind: 'permission', status: 'pending' },
        };
        const screen = await renderToolCallsGroupView({
            toolMessages: [pending, createToolCallMessageFixture({ id: 'ordinary', createdAt: 2 })],
        });
        expect(screen.findByTestId('permission-footer.allow')).not.toBeNull();
        expect(screen.findByTestId('permission-footer.deny')).not.toBeNull();
        expect(screen.findAllByTestId('transcript-tool-calls-preview-row')).toHaveLength(1);
        expect(screen.findByTestId('transcript-tool-calls-header')?.props.accessibilityState).toMatchObject({ expanded: false });

        const { ToolCallsGroupView } = await import('./ToolCallsGroupView');
        const props = {
            id: 'toolCalls:1',
            status: 'running' as const,
            metadata: null,
            sessionId: 's1',
            expanded: false,
            setExpanded: () => {},
            interaction: { canSendMessages: true, canApprovePermissions: true },
        };
        // 同一已挂载整组在审批结束或会话失效后恢复摘要，不留下过期按钮。
        for (const status of ['approved', 'denied', 'canceled'] as const) {
            await screen.update(<ToolCallsGroupView {...props} toolMessages={[
                { ...pending, tool: { ...pending.tool, permission: { id: 'permission-1', status } } },
            ]} />);
            expect(screen.findByTestId('permission-footer.allow')).toBeNull();
            expect(screen.findAllByTestId('transcript-tool-calls-preview-row')).toHaveLength(0);
        }
        await screen.update(<ToolCallsGroupView {...props} toolMessages={[{ ...pending, tool: { ...pending.tool, state: 'completed' } }]} />);
        expect(screen.findAllByTestId('transcript-tool-calls-preview-row')).toHaveLength(0);
        for (const reason of ['inactive', 'readOnly', 'notGranted'] as const) {
            await screen.update(<ToolCallsGroupView {...props} toolMessages={[pending]} interaction={{ canSendMessages: false, canApprovePermissions: false, permissionDisabledReason: reason }} />);
            expect(screen.findByTestId('permission-footer.allow')).toBeNull();
            expect(screen.findAllByTestId('transcript-tool-calls-preview-row')).toHaveLength(0);
        }
        await screen.update(<ToolCallsGroupView {...props} toolMessages={[pending]} />);
        expect(screen.findByTestId('permission-footer.allow')).not.toBeNull();
    });
});
