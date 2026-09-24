import React from 'react';
import { act } from 'react-test-renderer';
import { describe, it, expect, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import { createReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';
import { createUnistylesMock } from '@/dev/testkit/mocks/unistyles';
vi.mock('react-native', async () => { const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative'); return createReactNativeWebMock(); });
vi.mock('react-native-unistyles', async () => { const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles'); return createUnistylesMock(); });
vi.mock('@/components/ui/text/Text', () => createPassThroughModule(['Text']));
vi.mock('@/components/ui/buttons/RoundButton', () => createPassThroughModule(['RoundButton']));
describe('desktop approval panel', () => {
    // 使用协议原值验证已知说明与未知降级，不能把内部码直接放到审批卡片。
    it.each([
        ['unsupported_request', '当前请求类型暂不支持在手机处理。'],
        ['approval_details_incomplete', '操作详情不完整，请在电脑查看并处理。'],
        ['future_internal_reason', '当前操作需要在电脑查看并处理。'],
    ])('shows a readable explanation for %s', async (reason, expected) => {
        const { DesktopApprovalPanel } = await import('./DesktopApprovalPanel');
        const request = { requestId: 'r', revision: 'v', kind: 'unsupported' as const, canDecide: false, reason,
            files: [{ path: '/synthetic/a', kind: 'add' }, { path: '/synthetic/b', kind: 'delete' }, { path: '/synthetic/c', kind: 'update' }, { path: '/synthetic/d', kind: 'future_file_kind' }] };
        const control = { snapshot: { v: 1 as const, turnId: 'turn', state: 'running' as const, requests: [request] }, error: null, busy: false, loading: false, outcome: null, refresh: vi.fn(), decide: vi.fn(), steer: vi.fn(), sendText: vi.fn(), isRequestLocked: () => false };
        const screen = await renderScreen(<DesktopApprovalPanel control={control} canWrite />);
        const text = JSON.stringify(screen.tree.toJSON());
        expect(text).toContain(expected);
        expect(text).not.toContain(reason);
        expect(text).toContain('新增 · /synthetic/a');
        expect(text).toContain('删除 · /synthetic/b');
        expect(text).toContain('修改 · /synthetic/c');
        expect(text).toContain('文件操作 · /synthetic/d');
        expect(text).not.toContain('future_file_kind');
        expect(screen.findByTestId('desktop-approval-allow-r')?.props.disabled).toBe(true);
    });

    it('shows actual details and submits only an explicit one-time decision', async () => {
        const { DesktopApprovalPanel } = await import('./DesktopApprovalPanel');
        const request = { requestId: 'r', revision: 'v', kind: 'command' as const, canDecide: true, command: 'echo sample', cwd: '/synthetic' };
        const decide = vi.fn();
        const control = { snapshot: { v: 1 as const, turnId: 'turn', state: 'running' as const, requests: [request] }, error: null, busy: false, loading: false, outcome: null, refresh: vi.fn(), decide, steer: vi.fn(), sendText: vi.fn(), isRequestLocked: () => false };
        const screen = await renderScreen(<DesktopApprovalPanel control={control} canWrite />);
        expect(screen.findByTestId('desktop-approval-command-r')?.props.children).toBe('echo sample');
        screen.pressByTestId('desktop-approval-allow-r');
        expect(decide).toHaveBeenCalledWith(request, 'allow_once');
        await act(async () => { screen.tree.update(<DesktopApprovalPanel control={{ ...control, outcome: 'unknown', isRequestLocked: () => true }} canWrite />); });
        expect(screen.findByTestId('desktop-approval-allow-r')?.props.disabled).toBe(true);
        expect(screen.findByTestId('desktop-control-outcome')?.props.children).toContain('待确认');
    });
});
