import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as LegendNative from '@legendapp/list/react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { Platform } from 'react-native';

import {
    assertShippedNativeLegendRuntime,
    createShippedNativeNodeMock,
    readShippedNativeModuleFacts,
    readShippedNativeTreeFacts,
    resolveShippedNativeHarnessPlatform,
    type ShippedNativeNodeMock,
} from '@/dev/testkit/legend/shippedNativeLegendRuntime';

/**
 * The first tests in this repository that execute the code path the user runs: Legend's NATIVE
 * build, `Platform.OS === 'ios'`, New Architecture ON.
 *
 * Every other transcript-renderer test resolves `react-native.web.mjs` (see
 * `vitest.integration.config.ts`), and the one pre-existing native lane runs OLD architecture. The
 * contracts below are native-exclusive by construction - the web build has no scroll-adjust view to
 * read, because it drives `el.scrollTop` directly instead.
 */

type Row = Readonly<{ id: string }>;

const ROW_HEIGHT = 100;
const VIEWPORT_HEIGHT = 300;

function buildRows(count: number, offset = 0): Row[] {
    return Array.from({ length: count }, (_value, index) => ({ id: `row-${offset + index}` }));
}

const moduleFacts = () => readShippedNativeModuleFacts(LegendNative, Platform);

type MountedList = Readonly<{
    nodes: ShippedNativeNodeMock;
    screen: ReactTestRenderer;
}>;

let mounted: MountedList | null = null;

afterEach(() => {
    if (mounted) {
        const current = mounted;
        act(() => current.screen.unmount());
        mounted = null;
    }
});

async function mountList(data: readonly Row[]): Promise<MountedList> {
    const nodes = createShippedNativeNodeMock({ rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT_HEIGHT });
    let screen: ReactTestRenderer | null = null;
    await act(async () => {
        screen = create(
            <LegendList
                data={[...data]}
                estimatedItemSize={ROW_HEIGHT}
                keyExtractor={(item: Row) => item.id}
                maintainVisibleContentPosition
                recycleItems={false}
                renderItem={({ item }: { item: Row }) => <React.Fragment>{item.id}</React.Fragment>}
            />,
            { createNodeMock: nodes.createNodeMock },
        );
    });
    const created = screen as unknown as ReactTestRenderer;
    await act(async () => {
        created.root.findByType('ScrollView' as never).props.onLayout({
            nativeEvent: { layout: { height: VIEWPORT_HEIGHT, width: 800, x: 0, y: 0 } },
        });
        await Promise.resolve();
    });
    mounted = { nodes, screen: created };
    return mounted;
}

async function scrollTo(list: MountedList, offset: number): Promise<void> {
    await act(async () => {
        list.screen.root.findByType('ScrollView' as never).props.onScroll({
            nativeEvent: {
                contentOffset: { x: 0, y: offset },
                contentSize: { height: 1e6, width: 800 },
                layoutMeasurement: { height: VIEWPORT_HEIGHT, width: 800 },
            },
        });
        await Promise.resolve();
    });
}

async function setData(list: MountedList, data: readonly Row[]): Promise<void> {
    await act(async () => {
        list.screen.update(
            <LegendList
                data={[...data]}
                estimatedItemSize={ROW_HEIGHT}
                keyExtractor={(item: Row) => item.id}
                maintainVisibleContentPosition
                recycleItems={false}
                renderItem={({ item }: { item: Row }) => <React.Fragment>{item.id}</React.Fragment>}
            />,
        );
        await Promise.resolve();
    });
}

describe('shipped native Legend lane', () => {
    it('executes the native build on a mobile OS with New Architecture on', async () => {
        const list = await mountList(buildRows(20));

        // Throws with a per-violation breakdown if the lane degraded to the web build, to
        // `Platform.OS = 'node'`, or to old architecture.
        const facts = assertShippedNativeLegendRuntime(list.screen, moduleFacts());

        expect({
            hasDomHosts: facts.renderedDomHosts,
            hostTypes: facts.hostTypes,
            isNewArchitecture: moduleFacts().isNewArchitecture,
            platformOS: moduleFacts().platformOS,
            rowFlavors: [...new Set(facts.positionViews.map((view) => view.flavor))],
        }).toEqual({
            hasDomHosts: false,
            // `Animated.View` is the content container; `View` covers the scroll-adjust carrier and
            // every row. A `div` here would mean the web artifact resolved.
            hostTypes: ['Animated.View', 'ScrollView', 'View'],
            isNewArchitecture: true,
            // Defaults to iOS; `HAPPIER_LEGEND_NATIVE_OS=android` reruns the whole lane as Android.
            // Not vacuous: the resolver rejects any value other than those two, and the guard above
            // independently fails the run if the library ever sees 'node' or 'web'.
            platformOS: resolveShippedNativeHarnessPlatform(),
            rowFlavors: ['fabric-state'],
        });
    });

    it('measures the scroller in a layout effect, which only New Architecture does', async () => {
        // `useOnLayoutSync` mounts its measuring layout effect inside `if (IsNewArchitecture)`
        // (react-native.mjs:5490) and the scroller call site takes the default
        // `measureInLayoutEffect = true` (react-native.mjs:7572). On old architecture the hook is
        // never installed, so the list only ever learns its viewport from an `onLayout` event.
        const nodes = createShippedNativeNodeMock({ rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT_HEIGHT });
        let measuredScroller = false;
        const measuringNodes: ShippedNativeNodeMock = {
            createNodeMock: (element) => {
                const node = nodes.createNodeMock(element);
                if (node === nodes.scroller) {
                    return {
                        ...nodes.scroller,
                        measure: (callback: (x: number, y: number, w: number, h: number) => void) => {
                            measuredScroller = true;
                            callback(0, 0, 800, VIEWPORT_HEIGHT);
                        },
                    };
                }
                return node;
            },
            scroller: nodes.scroller,
        };

        let screen: ReactTestRenderer | null = null;
        await act(async () => {
            screen = create(
                <LegendList
                    data={buildRows(20)}
                    estimatedItemSize={ROW_HEIGHT}
                    keyExtractor={(item: Row) => item.id}
                    recycleItems={false}
                    renderItem={({ item }: { item: Row }) => <React.Fragment>{item.id}</React.Fragment>}
                />,
                { createNodeMock: measuringNodes.createNodeMock },
            );
        });
        mounted = { nodes: measuringNodes, screen: screen as unknown as ReactTestRenderer };

        expect(measuredScroller).toBe(true);
    });

    it('compensates a data prepend through the open-loop native scroll adjust', async () => {
        const list = await mountList(buildRows(20));
        assertShippedNativeLegendRuntime(list.screen, moduleFacts());
        await scrollTo(list, 500);

        const before = readShippedNativeTreeFacts(list.screen).scrollAdjustPx;

        const PREPENDED_ROWS = 5;
        await setData(list, [...buildRows(PREPENDED_ROWS, -PREPENDED_ROWS), ...buildRows(20)]);

        const after = readShippedNativeTreeFacts(list.screen).scrollAdjustPx;

        // `requestAdjust` (react-native.mjs:1664) is the whole native MVCP mechanism: it moves
        // `scrollAdjust` by the position delta and lets the biased `ScrollAdjust` view carry it.
        // Content inserted ABOVE the anchor pushes it down, so the adjust must grow by exactly the
        // inserted height to hold the anchor still. If maintainVisibleContentPosition regressed to
        // a no-op the adjust stays at 0 and the user's content jumps by that same height - which is
        // the class of defect this lane exists to catch.
        expect({ after, before }).toEqual({
            after: PREPENDED_ROWS * ROW_HEIGHT,
            before: 0,
        });
    });
});

// Android Fabric can deliver the MVCP carrier's mount after a scrollToEnd command.
// Exercise the shipped module; only native host layout/commands/events are simulated.
// No Legend state is seeded, and native compensation comes from its real carrier delta.
describe.skipIf(resolveShippedNativeHarnessPlatform() !== 'android')('held-end size-only native mounts', () => {
    const rowHeight = 46;
    const viewport = 300;
    let resizeScreen: ReactTestRenderer | null = null;

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        if (resizeScreen) act(() => resizeScreen!.unmount());
        resizeScreen = null;
        vi.useRealTimers();
    });

    /** 挂载真实列表，仅模拟原生布局、滚动命令与回执，分别保留物理位置和列表计算位置。 */
    async function mountResizeList() {
        const ref = React.createRef<LegendListRef>();
        let data = buildRows(20);
        let heldEnd = true;
        let physicalY = 0;
        let nativeContent = data.length * rowHeight;
        let nativeAdjust = 0;
        const commands: number[] = [];
        const clamp = (y: number) => Math.max(0, Math.min(y, nativeContent - viewport));
        const scroller = {
            measure: (cb: (...args: number[]) => void) => cb(0, 0, 800, viewport),
            scrollTo: ({ y = 0 }: { y?: number }) => { physicalY = clamp(y); commands.push(physicalY); },
            scrollToEnd: () => { physicalY = clamp(nativeContent - viewport); commands.push(physicalY); },
            getScrollableNode: () => scroller,
            getScrollResponder: () => scroller,
            getNativeScrollRef: () => scroller,
            flashScrollIndicators: () => {},
            setNativeProps: () => {},
        };
        // 原生测量值随布局变化；不直接改写列表内部状态。
        const createNodeMock = (element: React.ReactElement) => {
            if (String(element.type) === 'ScrollView') return scroller;
            const node = {
                measuredHeight: rowHeight,
                measure: (cb: (...args: number[]) => void) => cb(0, 0, 800, node.measuredHeight),
                setNativeProps: () => {},
            };
            return node;
        };
        const view = () => <LegendList
            ref={ref} data={data} estimatedItemSize={rowHeight}
            keyExtractor={(row: Row) => row.id}
            maintainScrollAtEnd={{ animated: false, isMaintainingScrollAtEnd: () => heldEnd }}
            maintainVisibleContentPosition={{ data: true, size: true }}
            recycleItems={false}
            renderItem={({ item }: { item: Row }) => React.createElement('SyntheticSizedRow', { id: item.id })}
        />;
        await act(async () => { resizeScreen = create(view(), { createNodeMock }); });
        const screen = resizeScreen!;
        assertShippedNativeLegendRuntime(screen, moduleFacts());
        const captureScroll = () => ({ nativeEvent: {
            contentOffset: { x: 0, y: physicalY },
            contentSize: { width: 800, height: nativeContent },
            layoutMeasurement: { width: 800, height: viewport },
            contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
            timestamp: Date.now(),
        } });
        // 允许延迟送达之前捕获的原生事件，验证布局和事件交错。
        const emitScroll = async (event = captureScroll()) => {
            await act(async () => { screen.root.findByType('ScrollView' as never).props.onScroll(event); });
        };
        const advance = async (ms: number) => {
            await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
        };
        await act(async () => { void ref.current!.scrollToEnd({ animated: false }); });
        for (let n = 0; n < 5; n++) { await advance(100); await emitScroll(); }
        expect(ref.current!.getState().scroll).toBe(nativeContent - viewport);

        return {
            ref, commands, advance, captureScroll, emitScroll,
            get physicalY() { return physicalY; },
            get expectedEnd() { return Math.max(0, ref.current!.getState().contentLength - viewport); },
            /** 经实际行布局回调触发尺寸变化。 */
            async resize(index: number, height: number) {
                const row = screen.root.findAllByType('SyntheticSizedRow' as never)
                    .find((item) => item.props.id === data[index].id)!;
                expect(row).toBeTruthy();
                let host: typeof row | null = row;
                while (host && !(typeof host.type === 'string' && typeof host.props.onLayout === 'function')) host = host.parent;
                expect(host).toBeTruthy();
                const node = ref.current!.getState().elementAtIndex(index) as unknown as { measuredHeight: number };
                expect(node).toBeTruthy();
                node.measuredHeight = height;
                await act(async () => { host!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 800, height } } }); });
            },
            /** 模拟原生提交内容尺寸，并将越界位置收束到有效范围。 */
            commitContent(height = ref.current!.getState().contentLength) {
                nativeContent = height;
                physicalY = clamp(physicalY);
            },
            /** 只应用真实补偿载体的差值，不人为注入候选已经取消的负补偿。 */
            commitAnchor() {
                const nextAdjust = readShippedNativeTreeFacts(screen).scrollAdjustPx!;
                physicalY = clamp(physicalY + nextAdjust - nativeAdjust);
                nativeAdjust = nextAdjust;
            },
            /** 通过正常数据更新追加一行，覆盖数据与尺寸变化合并提交的场景。 */
            async append() {
                data = [...data, { id: 'appended-row' }];
                await act(async () => { screen.update(view()); });
            },
            /** 用户阅读历史时释放跟随意图，取消待执行的末尾维护。 */
            async readHistory(y: number) {
                heldEnd = false;
                ref.current!.cancelScroll();
                physicalY = y;
                await emitScroll();
            },
            /** 排空有限维护动作，确认物理末尾正确且没有残留定时器。 */
            async assertSettledAtEnd() {
                await advance(5_000);
                expect(physicalY).toBe(this.expectedEnd);
                expect(vi.getTimerCount()).toBe(0);
            },
        };
    }

    it.each(['native-before-end', 'native-after-end', 'content-after-end'] as const)(
        'keeps the last row visible with %s ordering', async (order) => {
            const list = await mountResizeList();
            await list.resize(19, 0);
            if (order === 'content-after-end') await list.advance(20);
            list.commitContent();
            if (order === 'native-before-end') { list.commitAnchor(); await list.emitScroll(); }
            if (order !== 'content-after-end') await list.advance(20);
            if (order !== 'native-before-end') list.commitAnchor();
            await list.emitScroll();
            await list.assertSettledAtEnd();
        },
    );

    it.each([23, 46])('coalesces shrink with a %i px growth without waiting for a nonexistent native event', async (growth) => {
        const list = await mountResizeList();
        await list.resize(19, 0);
        await list.resize(18, rowHeight + growth);
        list.commitContent();
        await list.advance(20);
        list.commitAnchor();
        // Full cancellation has no physical movement, so native need not emit onScroll.
        if (growth !== rowHeight) await list.emitScroll();
        await list.assertSettledAtEnd();
        await list.resize(18, rowHeight + growth + rowHeight);
        list.commitContent();
        await list.advance(20);
        list.commitAnchor();
        await list.assertSettledAtEnd();
    });

    it('accepts two native clamp events delivered after the second size change', async () => {
        const list = await mountResizeList();
        await list.resize(19, 0);
        list.commitContent();
        const firstEvent = list.captureScroll();
        await list.resize(18, 0);
        list.commitContent();
        const secondEvent = list.captureScroll();
        await list.emitScroll(firstEvent);
        await list.advance(20);
        list.commitAnchor();
        await list.emitScroll(secondEvent);
        await list.emitScroll();
        await list.assertSettledAtEnd();
    });

    it('handles a native clamp that precedes the delayed row measurement without another scroll event', async () => {
        const list = await mountResizeList();
        list.commitContent(20 * rowHeight - rowHeight);
        await list.emitScroll();
        await list.resize(19, 0);
        await list.assertSettledAtEnd();
    });

    it('does not block when a data append cancels a size shrink in the same native mount', async () => {
        const list = await mountResizeList();
        await list.resize(19, 0);
        await list.append();
        list.commitContent();
        await list.advance(20);
        list.commitAnchor();
        await list.assertSettledAtEnd();
        await list.resize(20, rowHeight * 2);
        list.commitContent();
        await list.advance(20);
        list.commitAnchor();
        await list.assertSettledAtEnd();
    });

    it('releases queued end maintenance when the reader scrolls into history', async () => {
        const list = await mountResizeList();
        await list.resize(19, 0);
        list.commitContent();
        await list.readHistory(450);
        const commandsBefore = list.commands.length;
        await list.advance(5_000);
        expect(list.physicalY).toBe(450);
        expect(list.commands).toHaveLength(commandsBefore);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the reading anchor for a size shrink above the viewport when held-end is released', async () => {
        const list = await mountResizeList();
        await list.readHistory(450);
        const commandsBefore = list.commands.length;
        await list.resize(8, 0);
        list.commitContent();
        list.commitAnchor();
        await list.emitScroll();
        await list.advance(5_000);
        expect(list.physicalY).toBe(450 - rowHeight);
        expect(list.commands).toHaveLength(commandsBefore);
        expect(vi.getTimerCount()).toBe(0);
    });
});
