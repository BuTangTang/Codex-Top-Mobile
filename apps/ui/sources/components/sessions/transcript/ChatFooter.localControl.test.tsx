import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installTranscriptCommonModuleMocks, resetTranscriptCommonModuleMockState } from './transcriptTestHelpers';
let ChatFooter: typeof import('./ChatFooter')['ChatFooter'];
let Platform: typeof import('react-native')['Platform'];

(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => 'phone' }));

installTranscriptCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Text: 'Text',
            Pressable: 'Pressable',
            Platform: { OS: 'web', select: (options: any) => options?.web ?? options?.default ?? options?.ios ?? null },
            AppState: { addEventListener: () => ({ remove: () => {} }) },
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                surface: '#fff',
                divider: '#ddd',
                groupped: { sectionTitle: '#444' },
                shadow: { color: '#000', opacity: 0.2 },
                button: {
                    primary: {
                        tint: '#ffffff',
                    },
                },
                box: { warning: { background: '#fff3cd', text: '#856404' } },
            },
        });
    },
    text: async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock({
        translate: (key: string) => key,
    }),
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 800 },
}));


/** 在边界夹具初始化后装载组件，保证手机测试与组件看到同一 Platform 实例。 */
beforeAll(async () => {
    ({ Platform } = await import('react-native'));
    ({ ChatFooter } = await import('./ChatFooter'));
});

async function renderFooter(props: React.ComponentProps<typeof ChatFooter>) {
    return renderScreen(<ChatFooter {...props} />);
}

function findTextNode(screen: Awaited<ReturnType<typeof renderFooter>>, text: string) {
    return screen.findAll((node) => String(node.type) === 'Text' && node.props?.children === text)[0] ?? null;
}


describe('ChatFooter (local control)', () => {
    afterEach(() => {
        Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
        resetTranscriptCommonModuleMockState();
        standardCleanup();
    });

    it('renders a switch-to-remote button when controlled by user', async () => {
        const screen = await renderFooter({
            controlledByUser: true,
            onRequestSwitchToRemote: vi.fn(),
        });

        expect(screen.findByTestId('session-chatFooter-switchToRemote')).not.toBeNull();
        expect(screen.getTextContent()).toContain('chatFooter.permissionsTerminalOnly');
    });

    it('shows a local-running notice (without terminal-only copy) when the local permission bridge is enabled', async () => {
        const screen = await renderFooter({
            controlledByUser: true,
            permissionsInUiWhileLocal: true,
            onRequestSwitchToRemote: vi.fn(),
        });

        expect(screen.getTextContent()).toContain('chatFooter.sessionRunningLocally');
        expect(screen.getTextContent()).not.toContain('chatFooter.permissionsTerminalOnly');
        expect(screen.findByTestId('session-chatFooter-switchToRemote')).not.toBeNull();
    });

    it('does not render footer actions when the session is not locally controlled', async () => {
        const screen = await renderFooter({
            controlledByUser: false,
        });

        expect(screen.findByTestId('session-chatFooter-switchToRemote')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-switchToLocal')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-detachLocalTerminal')).toBeNull();
    });

    it('hides the local-control banner when remote sessions cannot attach locally', async () => {
        const screen = await renderFooter({
            controlledByUser: false,
            localControl: {
                attached: false,
                topology: 'exclusive',
                remoteWritable: true,
                canAttach: false,
                canDetach: false,
            },
        } as any);

        expect(screen.findByTestId('session-chatFooter-switchToRemote')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-switchToLocal')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-detachLocalTerminal')).toBeNull();
        expect(screen.getTextContent()).not.toContain('chatFooter.permissionsTerminalOnly');
    });

    it('renders a switching-to-remote message and hides the action while a control switch is in flight', async () => {
        const screen = await renderFooter({
            controlledByUser: true,
            controlSwitchTo: 'remote',
            onRequestSwitchToRemote: vi.fn(),
        });

        expect(screen.getTextContent()).toContain('chatFooter.switchingToRemote');
        expect(screen.findByTestId('session-chatFooter-switchToRemote')).toBeNull();
    });

    it('renders a detach-local action for shared local attachment', async () => {
        const screen = await renderFooter({
            localControl: {
                attached: true,
                topology: 'shared',
                remoteWritable: true,
                canAttach: true,
                canDetach: true,
            },
            onRequestSwitchToRemote: vi.fn(),
        } as any);

        expect(screen.getTextContent()).toContain('chatFooter.sessionRunningLocallyAndRemotely');
        expect(screen.findByTestId('session-chatFooter-detachLocalTerminal')).not.toBeNull();
        expect(screen.findByTestId('session-chatFooter-switchToRemote')).toBeNull();
    });

    it('hides the local-control banner for remote-writable shared attachments with no detach action', async () => {
        const screen = await renderFooter({
            controlledByUser: false,
            localControl: {
                attached: true,
                topology: 'shared',
                remoteWritable: true,
                canAttach: true,
                canDetach: false,
            },
            onRequestSwitchToRemote: vi.fn(),
        } as any);

        expect(screen.getTextContent()).not.toContain('chatFooter.sessionRunningLocally');
        expect(screen.getTextContent()).not.toContain('chatFooter.sessionRunningLocallyAndRemotely');
        expect(screen.findByTestId('session-chatFooter-switchToRemote')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-detachLocalTerminal')).toBeNull();
    });

    it('does not render app-side switch-to-local for shared remote sessions that can be attached locally', async () => {
        const screen = await renderFooter({
            controlledByUser: false,
            localControl: {
                attached: false,
                topology: 'shared',
                remoteWritable: true,
                canAttach: true,
                canDetach: false,
            },
            onRequestSwitchToLocal: vi.fn(),
        } as any);

        // Remote -> local takeover is intentionally not exposed in the app transcript UI.
        // Users should attach from their terminal instead; keep this assertion so future
        // changes do not reintroduce the misleading "Switch to local" banner/button.
        expect(screen.findByTestId('session-chatFooter-switchToLocal')).toBeNull();
        expect(screen.getTextContent()).not.toContain('chatFooter.switchToLocal');
    });

    it('does not render app-side switch-to-local for exclusive remote sessions that can be attached locally', async () => {
        const screen = await renderFooter({
            controlledByUser: false,
            localControl: {
                attached: false,
                topology: 'exclusive',
                remoteWritable: true,
                canAttach: true,
                canDetach: false,
            },
            onRequestSwitchToLocal: vi.fn(),
        } as any);

        // Remote -> local takeover is intentionally not exposed in the app transcript UI.
        // Users should attach from their terminal instead; keep this assertion so future
        // changes do not reintroduce the misleading "Switch to local" banner/button.
        expect(screen.findByTestId('session-chatFooter-switchToLocal')).toBeNull();
        expect(screen.getTextContent()).not.toContain('chatFooter.switchToLocal');
    });

    it('keeps the direct control notice without duplicating the header takeover actions', async () => {
        const onRequestTakeOverDirect = vi.fn();
        const onRequestTakeOverPersist = vi.fn();
        const screen = await renderFooter({
            controlledByUser: false,
            directControl: {
                machineOnline: true,
                runnerActive: false,
                activity: 'active_recently',
                canTakeOverDirect: true,
                canTakeOverPersist: true,
                takeoverInFlight: null,
                onRequestTakeOverDirect,
                onRequestTakeOverPersist,
            },
        } as any);

        expect(screen.getTextContent()).toContain('chatFooter.directSessionTakeoverAvailable');
        expect(screen.findByTestId('session-chatFooter-takeOverDirect')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-takeOverPersist')).toBeNull();
        expect(onRequestTakeOverDirect).not.toHaveBeenCalled();
        expect(onRequestTakeOverPersist).not.toHaveBeenCalled();
    });

    it('renders a takeover-in-flight message and hides direct takeover actions while a direct switch is pending', async () => {
        const screen = await renderFooter({
            controlledByUser: false,
            directControl: {
                machineOnline: true,
                runnerActive: false,
                activity: 'running',
                canTakeOverDirect: true,
                canTakeOverPersist: true,
                takeoverInFlight: 'direct',
            },
        } as any);

        expect(screen.getTextContent()).toContain('chatFooter.switchingToDirectTakeover');
        expect(screen.findByTestId('session-chatFooter-takeOverDirect')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-takeOverPersist')).toBeNull();
    });

    /** 手机正常可发送时省去解释，但离线与未知状态仍有可见说明。 */
    it('keeps phone capability warnings while omitting its healthy repeated explanation', async () => {
        // 修改已装载的原生边界，避免静态组件导入早于辅助 mock 选项初始化。
        Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
        const directControl = {
            machineOnline: true, runnerActive: false, activity: 'idle' as const,
            canTakeOverDirect: false, canTakeOverPersist: false, takeoverInFlight: null,
            inheritsDesktopSettings: true, externalControl: { canSend: true },
        };
        const screen = await renderFooter({ directControl });
        expect(screen.findByTestId('session-chatFooter-directControl-ready')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-directControl')).toBeNull();
        await act(async () => { screen.tree.update(<ChatFooter directControl={{ ...directControl, machineOnline: false }} />); });
        expect(screen.findByTestId('session-chatFooter-directControl')).not.toBeNull();
        expect(screen.getTextContent()).toContain('chatFooter.directSessionMachineOffline');
        await act(async () => { screen.tree.update(<ChatFooter directControl={{ ...directControl, externalControl: undefined }} />); });
        expect(screen.getTextContent()).toContain('chatFooter.directSessionDesktopUnknown');
    });

    it('keeps offline desktop warning even when its last capability allowed text', async () => {
        // 旧的可发送能力不能覆盖新的来源离线事实。
        const screen = await renderFooter({ directControl: {
            machineOnline: false, runnerActive: false, activity: 'unknown',
            canTakeOverDirect: false, canTakeOverPersist: false, takeoverInFlight: null,
            inheritsDesktopSettings: true, externalControl: { canSend: true },
        } });
        expect(screen.findByTestId('session-chatFooter-directControl-ready')).toBeNull();
        expect(screen.findByTestId('session-chatFooter-directControl')).not.toBeNull();
        expect(screen.getTextContent()).toContain('chatFooter.directSessionMachineOffline');
    });

    // 能力提示属于现有页脚；未知原因不回显原始诊断，明确接管仍由用户单独触发。
    it.each([
        [{ canSend: true }, 'chatFooter.directSessionDesktopReady'],
        [{ canSend: false }, 'chatFooter.directSessionDesktopUnavailable'],
        [{ canSend: false, unavailableReason: 'owner_unavailable' }, 'chatFooter.directSessionDesktopDisconnected'],
        [{ canSend: false, unavailableReason: 'incompatible_protocol' }, 'chatFooter.directSessionDesktopUnsupported'],
        [{ canSend: false, unavailableReason: '/private/diagnostic?token=secret' }, 'chatFooter.directSessionDesktopUnavailable'],
        [undefined, 'chatFooter.directSessionDesktopUnknown'],
    ] as const)('shows the current desktop text capability %j without taking over', async (externalControl, noticeKey) => {
        const onRequestTakeOverDirect = vi.fn();
        const screen = await renderFooter({
            directControl: {
                machineOnline: true, runnerActive: false, activity: 'idle',
                canTakeOverDirect: true, canTakeOverPersist: false, takeoverInFlight: null,
                inheritsDesktopSettings: true,
                externalControl,
                onRequestTakeOverDirect,
            },
        });
        expect(screen.getTextContent()).toContain(noticeKey);
        if (externalControl?.canSend === true) {
            expect(screen.findByTestId('session-chatFooter-directControl-ready')).not.toBeNull();
            expect(screen.findByTestId('session-chatFooter-directControl')).toBeNull();
        } else {
            expect(screen.findByTestId('session-chatFooter-directControl-ready')).toBeNull();
            expect(screen.findByTestId('session-chatFooter-directControl')).not.toBeNull();
        }

        expect(screen.getTextContent()).not.toContain('/private/diagnostic');
        expect(screen.getTextContent()).not.toContain('chatFooter.directSessionTakeoverAvailable');
        expect(onRequestTakeOverDirect).not.toHaveBeenCalled();
        expect(screen.findByTestId('session-chatFooter-takeOverDirect')).toBeNull();
    });
});
