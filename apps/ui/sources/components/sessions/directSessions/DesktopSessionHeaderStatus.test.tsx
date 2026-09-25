import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import type { CustomModalConfig } from '@/modal/types';
import type { UseDirectSessionRuntimeResult } from '@/components/sessions/model/useDirectSessionRuntime';
import { DesktopSessionHeaderStatus } from './DesktopSessionHeaderStatus';

const modal = vi.hoisted(() => ({ show: vi.fn(() => 'status-details'), update: vi.fn(), hide: vi.fn() }));
vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'android' });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: modal }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/components/ui/buttons/RoundButton', () => createPassThroughModule(['RoundButton']));
vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => 'phone' }));

type Control = NonNullable<UseDirectSessionRuntimeResult['control']>;
type HeaderProps = React.ComponentProps<typeof DesktopSessionHeaderStatus>;

/** 合成控制器保留真实接口，命令与文件审批仍由生产 DesktopApprovalPanel 执行。 */
function createControl(overrides: Partial<Control> = {}): Control {
    return {
        snapshot: null, error: null, busy: false, loading: false, outcome: null, outcomeKind: null,
        refresh: vi.fn(async () => null), decide: vi.fn(async () => {}),
        steer: vi.fn(async () => false), sendText: vi.fn(async () => ({ outcome: 'rejected' as const })), isRequestLocked: () => false,
        ...overrides,
    };
}

/** 只构造明确生命周期事实，不利用活动时间或控制回执推断状态。 */
function createProps(overrides: Partial<HeaderProps> = {}): HeaderProps {
    return {
        sourceLabel: '测试电脑 · 项目', canWrite: true, active: true,
        status: { ok: true, machineOnline: true, runnerActive: false, activity: 'unknown', canForceStop: false,
            canTakeOverDirect: false, canTakeOverPersist: false,
            externalControl: { canSend: true }, observation: { v: 1, state: 'running', source: 'desktop', turnId: 'turn-1' } },
        control: createControl(), refreshNow: vi.fn(async () => null), ...overrides,
    };
}

/** 通过 Modal 公共边界挂载生产详情，避免以假的审批组件替代权限与锁定逻辑。 */
async function openDetails(screen: Awaited<ReturnType<typeof renderScreen>>) {
    await screen.pressByTestIdAsync('desktop-session-header-details');
    const config = (modal.show.mock.calls.at(-1) as unknown as [CustomModalConfig])[0];
    const renderDetails = (props = config.props) => React.createElement(config.component, { ...props, onClose: vi.fn() });
    return { config, renderDetails, details: await renderScreen(renderDetails()) };
}

describe('desktop session header status', () => {
    afterEach(async () => {
        standardCleanup();
        const { storage } = await import('@/sync/domains/state/storageStore');
        storage.setState((state) => ({ localSettings: { ...state.localSettings, uiFontScale: 1 } }));
        vi.clearAllMocks();
    });

    /** 使用真实 Text 缩放和本地字号设置，验证父行能容纳文字及真实按钮边界。 */
    it.each([1, 2.5])('fits real scaled text and touch targets without changing height for lifecycle updates (scale %s)', async (uiFontScale) => {
        const { StyleSheet } = await import('react-native');
        const { storage } = await import('@/sync/domains/state/storageStore');
        storage.setState((state) => ({ localSettings: { ...state.localSettings, uiFontScale } }));
        const props = createProps({ control: createControl({ error: 'temporary' }) });
        const screen = await renderScreen(<DesktopSessionHeaderStatus {...props} />);
        const rowHeight = StyleSheet.flatten(screen.findByTestId('desktop-session-header-status')?.props.style).height;
        const renderedText = screen.findByTestId('desktop-session-header-observation');
        const textStyle = StyleSheet.flatten(renderedText?.props.style);
        expect(textStyle.lineHeight).toBe(20 * uiFontScale);
        expect(rowHeight).toBeGreaterThanOrEqual(textStyle.lineHeight + 8);
        for (const id of ['desktop-session-header-details', 'desktop-session-header-attention', 'desktop-session-header-refresh']) {
            const buttonHeight = StyleSheet.flatten(screen.findByTestId(id)?.props.style).height;
            expect(buttonHeight).toBeGreaterThanOrEqual(48);
            expect(rowHeight).toBeGreaterThanOrEqual(buttonHeight);
        }
        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...props} status={{ ...props.status!, observation: { v: 1, state: 'completed', source: 'desktop', turnId: 'turn-1' } }} />); });
        expect(StyleSheet.flatten(screen.findByTestId('desktop-session-header-status')?.props.style).height).toBe(rowHeight);
    });

    /** 使用真实缩放样式与 Yoga 约束验证状态优先级；合成字宽不替代原生字体验收。 */
    it.each([1.3, 2.5])('preserves the full short state and reachable pending action with a long source at scale %s', async (uiFontScale) => {
        const { default: Yoga } = await import('yoga-layout');
        const { StyleSheet } = await import('react-native');
        const { storage } = await import('@/sync/domains/state/storageStore');
        storage.setState((state) => ({ localSettings: { ...state.localSettings, uiFontScale } }));
        const props = createProps({ sourceLabel: '很长的电脑名称 · 很长的项目名称'.repeat(3),
            status: { ...createProps().status!, observation: { v: 1, state: 'needs_input', source: 'desktop', turnId: 'turn-1', requests: [{ requestId: 'request-1', kind: 'permission_request' }] } } });
        const screen = await renderScreen(<DesktopSessionHeaderStatus {...props} />);
        /** 从生产实际渲染样式读取 flex 规则，不在测试重写期望布局。 */
        const readStyle = (id: string) => StyleSheet.flatten(screen.findByTestId(id)?.props.style);
        const summaryElement = screen.findByTestId('desktop-session-header-details')!;
        const observationStyle = StyleSheet.flatten(summaryElement.props.children.props.style);
        const sourceElement = screen.tree.root.findAll((node) => String(node.type) === 'Text' && node.props.children === props.sourceLabel)[0];
        const sourceStyle = StyleSheet.flatten(sourceElement.props.style);
        const statusStyle = readStyle('desktop-session-header-observation');
        const rowStyle = readStyle('desktop-session-header-status');
        const layoutConfig = Yoga.Config.create();
        // 保留逻辑点精度；设备像素舍入由原生验收核对，不用宿主默认的 1 倍像素网格。
        layoutConfig.setPointScaleFactor(0);
        /** 仅映射该行已有的 Yoga flex 约束；字宽使用四个中文全角字的合成测量。 */
        const makeNode = (style: Record<string, any>) => {
            const node = Yoga.Node.create(layoutConfig);
            for (const key of ['flex', 'flexGrow', 'flexShrink', 'minWidth', 'maxWidth', 'width'] as const) {
                if (style[key] !== undefined && style[key] !== '100%') (node as any)[`set${key[0].toUpperCase()}${key.slice(1)}`](style[key]);
            }
            if (style.flexDirection === 'row') node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
            if (style.gap) node.setGap(Yoga.GUTTER_ALL, style.gap);
            return node;
        };
        const row = makeNode(rowStyle);
        const summary = makeNode(readStyle('desktop-session-header-details'));
        const observation = makeNode(observationStyle);
        const dot = makeNode(StyleSheet.flatten(summaryElement.props.children.props.children[0].props.style));
        const source = makeNode(sourceStyle);
        const status = makeNode(statusStyle);
        const attention = makeNode(readStyle('desktop-session-header-attention'));
        const refresh = makeNode(readStyle('desktop-session-header-refresh'));
        const statusWidth = 4 * statusStyle.fontSize;
        source.setMeasureFunc(() => ({ width: props.sourceLabel.length * sourceStyle.fontSize, height: sourceStyle.lineHeight }));
        status.setMeasureFunc(() => ({ width: statusWidth, height: statusStyle.lineHeight }));
        attention.setMeasureFunc(() => ({ width: 4 * statusStyle.fontSize + 40, height: statusStyle.lineHeight }));
        observation.insertChild(dot, 0); observation.insertChild(source, 1); observation.insertChild(status, 2);
        summary.insertChild(observation, 0); row.insertChild(summary, 0); row.insertChild(attention, 1); row.insertChild(refresh, 2);
        try {
            // 320dp 的窄手机仍保留完整短状态；来源与待处理长文可截短，按钮不能出屏。
            row.calculateLayout(320 - rowStyle.paddingLeft - rowStyle.paddingRight, rowStyle.height, Yoga.DIRECTION_LTR);
            expect(status.getComputedWidth()).toBeGreaterThanOrEqual(statusWidth - 0.001);
            expect(status.getComputedLeft() + status.getComputedWidth()).toBeLessThanOrEqual(summary.getComputedWidth() + 0.001);
            expect(attention.getComputedWidth()).toBeGreaterThanOrEqual(48);
            expect(attention.getComputedLeft() + attention.getComputedWidth()).toBeLessThanOrEqual(refresh.getComputedLeft() + 0.001);
            expect(refresh.getComputedLeft() + refresh.getComputedWidth()).toBeLessThanOrEqual(row.getComputedWidth() + 0.001);
            expect(screen.findByTestId('desktop-session-header-attention')?.props.accessibilityLabel).toContain('待处理');
        } finally { row.freeRecursive(); layoutConfig.free(); }
    });

    /** 控制错误仅影响详情，状态和当前页头实例保持连续，用户未操作时不请求额外刷新。 */
    it('keeps lifecycle separate from control failure and mounts safe details only on demand', async () => {
        const props = createProps({ control: createControl({ error: 'private raw transport diagnostic' }),
            status: { ...createProps().status!, externalControl: { canSend: false, unavailableReason: 'router_unavailable' } } });
        const screen = await renderScreen(<DesktopSessionHeaderStatus {...props} />);
        const row = screen.findByTestId('desktop-session-header-status');
        expect(screen.findByTestId('desktop-session-header-observation')?.props.children).toBe('directSessions.observation.running');
        expect(screen.findByTestId('desktop-approval-panel')).toBeNull();
        expect(modal.show).not.toHaveBeenCalled();
        expect(props.refreshNow).not.toHaveBeenCalled();
        expect(props.control?.refresh).not.toHaveBeenCalled();
        const { details, renderDetails } = await openDetails(screen);
        expect(details.getTextContent()).toContain('暂无法读取桌面待处理详情');
        expect(details.getTextContent()).not.toContain('private raw transport diagnostic');
        await screen.pressByTestIdAsync('desktop-session-header-refresh');
        expect(props.refreshNow).toHaveBeenCalledOnce();
        expect(props.control?.refresh).toHaveBeenCalledOnce();

        const recovered = createProps({ status: { ...props.status!, externalControl: { canSend: true },
            observation: { v: 1, state: 'completed', source: 'desktop', turnId: 'turn-1' } } });
        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...recovered} />); });
        expect(screen.findByTestId('desktop-session-header-status')).toBe(row);
        expect(screen.findByTestId('desktop-session-header-observation')?.props.children).toBe('directSessions.observation.completed');
        expect(screen.findByTestId('desktop-session-header-attention')).toBeNull();
        const updated = modal.update.mock.calls.at(-1)?.[1];
        await act(async () => { details.tree.update(renderDetails(updated)); });
        expect(details.getTextContent()).toContain('directSessions.observation.completed');
        expect(details.findByTestId('desktop-approval-panel')).toBeNull();
    });

    /** 已有恢复说明也能独立打开，发送被禁用不影响阅读，说明变化直接更新现有弹层。 */
    it('keeps inactive recovery notice available and updates it without changing the header row', async () => {
        const notice = { title: '无法恢复此会话', body: '请在电脑上查看原会话的恢复方式。' };
        const props = { ...createProps({ canWrite: false }), notice };
        const screen = await renderScreen(<DesktopSessionHeaderStatus {...props} />);
        const row = screen.findByTestId('desktop-session-header-status');
        expect(screen.findByTestId('desktop-session-header-attention')).not.toBeNull();
        const { details, renderDetails } = await openDetails(screen);
        expect(details.getTextContent()).toContain(notice.title);
        expect(details.getTextContent()).toContain(notice.body);
        const recovered = { ...props, notice: null };
        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...recovered} />); });
        await act(async () => { details.tree.update(renderDetails(modal.update.mock.calls.at(-1)?.[1])); });
        expect(screen.findByTestId('desktop-session-header-status')).toBe(row);
        expect(screen.findByTestId('desktop-session-header-attention')).toBeNull();
        expect(details.getTextContent()).not.toContain(notice.title);
    });

    /** 按需弹层保留命令与文件全文、原请求身份，并跟随审批锁定与权限实时变化。 */
    it('preserves actual approval actions and updates open details with current locks and write access', async () => {
        const command = { requestId: 'command-1', revision: 'revision-1', kind: 'command' as const, canDecide: true, command: 'echo 合成测试', cwd: '/synthetic' };
        const file = { requestId: 'file-1', revision: 'revision-1', kind: 'file_change' as const, canDecide: true,
            files: [{ path: '/synthetic/example.ts', kind: 'update', diff: '+测试变更' }] };
        const control = createControl({ snapshot: { v: 1, state: 'running', turnId: 'turn-1', requests: [command, file] } });
        const props = createProps({ control });
        const screen = await renderScreen(<DesktopSessionHeaderStatus {...props} />);
        expect(screen.findByTestId('desktop-session-header-attention')?.props.accessibilityLabel).toContain('待处理 2');
        const { details, renderDetails } = await openDetails(screen);
        expect(details.getTextContent()).toContain('echo 合成测试');
        expect(details.getTextContent()).toContain('+测试变更');
        await details.pressByTestIdAsync('desktop-approval-allow-command-1');
        expect(control.decide).toHaveBeenCalledWith(command, 'allow_once');

        const locked = { ...control, outcome: 'unknown' as const, outcomeKind: 'approval' as const, isRequestLocked: () => true };
        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...props} control={locked} />); });
        await act(async () => { details.tree.update(renderDetails(modal.update.mock.calls.at(-1)?.[1])); });
        expect(details.findByTestId('desktop-approval-allow-command-1')?.props.disabled).toBe(true);
        expect(details.getTextContent()).toContain('审批结果待确认');

        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...props} canWrite={false} />); });
        await act(async () => { details.tree.update(renderDetails(modal.update.mock.calls.at(-1)?.[1])); });
        expect(screen.findByTestId('desktop-session-header-details')?.props.disabled).not.toBe(true);
        expect(details.findByTestId('desktop-approval-deny-file-1')?.props.disabled).toBe(true);
        expect(details.getTextContent()).toContain('+测试变更');

        const newerFile = { ...file, revision: 'revision-2' };
        const nextControl = createControl({ snapshot: { ...control.snapshot!, requests: [newerFile] } });
        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...props} control={nextControl} />); });
        await act(async () => { details.tree.update(renderDetails(modal.update.mock.calls.at(-1)?.[1])); });
        expect(details.findByTestId('desktop-approval-allow-command-1')).toBeNull();
        await details.pressByTestIdAsync('desktop-approval-deny-file-1');
        expect(nextControl.decide).toHaveBeenCalledWith(newerFile, 'deny');
    });

    /** 尚无可审批快照的问题仍有明确入口，离开该会话后关闭详情而不启动额外网络活动。 */
    it('keeps unanswered desktop questions discoverable and closes details when the surface leaves focus', async () => {
        const props = createProps({ status: { ...createProps().status!, observation: {
            v: 1, state: 'needs_input', source: 'desktop', turnId: 'turn-1', requests: [{ requestId: 'question', kind: 'user_action_request' }],
        } } });
        const screen = await renderScreen(<DesktopSessionHeaderStatus {...props} />);
        expect(screen.findByTestId('desktop-session-header-attention')?.props.accessibilityLabel).toContain('待处理');
        const { details } = await openDetails(screen);
        expect(details.getTextContent()).toContain('请查看对话中的问题');
        expect(details.findByTestId('desktop-approval-panel')).toBeNull();
        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...props} active={false} />); });
        expect(modal.hide).toHaveBeenCalledWith('status-details');
        expect(props.refreshNow).not.toHaveBeenCalled();
    });

    /** 主动关闭后的更新不触碰旧弹层，重新打开读取当前数据，离开页面只清理新实例。 */
    it('reopens with current details after dismissal and does not retain a stale modal identifier', async () => {
        modal.show.mockReturnValueOnce('first-details').mockReturnValueOnce('second-details');
        const props = createProps();
        const screen = await renderScreen(<DesktopSessionHeaderStatus {...props} />);
        const { config } = await openDetails(screen);
        await act(async () => { config.onRequestClose?.(); });
        const updateCount = modal.update.mock.calls.length;
        const next = createProps({ sourceLabel: '电脑更新后的名称', canWrite: false, control: createControl({ error: 'temporary failure' }) });
        await act(async () => { screen.tree.update(<DesktopSessionHeaderStatus {...next} />); });
        expect(modal.update.mock.calls).toHaveLength(updateCount);
        const { details } = await openDetails(screen);
        expect(modal.show).toHaveBeenCalledTimes(2);
        expect(details.getTextContent()).toContain('电脑更新后的名称');
        expect(details.getTextContent()).toContain('暂无法读取桌面待处理详情');
        // 原弹层的延迟关闭回调不能丢失当前弹层的清理身份。
        await act(async () => { config.onRequestClose?.(); screen.tree.unmount(); });
        expect(modal.hide).toHaveBeenLastCalledWith('second-details');
    });
});
