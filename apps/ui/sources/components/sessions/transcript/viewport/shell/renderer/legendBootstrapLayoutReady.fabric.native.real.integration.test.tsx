import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as LegendNative from '@legendapp/list/react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Platform } from 'react-native';

import {
    assertShippedNativeLegendRuntime,
    createShippedNativeNodeMock,
    readShippedNativeModuleFacts,
} from '@/dev/testkit/legend/shippedNativeLegendRuntime';

type Bootstrap = Readonly<{
    scroll: number;
    previousResolvedOffset?: number;
    visibleIndices?: readonly number[];
}>;
type RuntimeContext = Readonly<{
    state: {
        didContainersLayout?: boolean;
        didFinishInitialScroll?: boolean;
        queuedInitialLayout?: boolean;
        initialScrollSession?: { bootstrap?: Bootstrap | null };
        startBuffered: number;
        endBuffered: number;
        idCache: Record<number, string>;
        sizesKnown: Map<string, number>;
        triggerCalculateItemsInView(params: Readonly<{ forceFullItemPositions: boolean }>): void;
    };
}>;

const internal = (LegendNative as unknown as {
    internal: { useStateContext(): RuntimeContext };
}).internal;
let context: RuntimeContext | null = null;
let mounted: ReactTestRenderer | null = null;

/** 读取真实列表的就绪状态，不替换判断函数或写入内部状态。 */
function StateProbe(): null {
    context = internal.useStateContext();
    return null;
}

afterEach(() => {
    if (mounted) act(() => mounted?.unmount());
    mounted = null;
    context = null;
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/** 只控制原生测量回调和帧调度这两个系统边界，所有初始化计算仍由已安装 Legend 执行。 */
async function mountBootstrapList() {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        const id = nextFrameId++;
        frames.set(id, callback);
        return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const measurements: Array<(height: number) => void> = [];
    const nodes = createShippedNativeNodeMock({ rowHeight: 100, viewportHeight: 400 });
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: `synthetic-${index}` }));
    await act(async () => {
        mounted = create(
            <LegendList
                data={rows}
                drawDistance={200}
                estimatedItemSize={100}
                initialScrollAtEnd
                keyExtractor={(item) => item.id}
                recycleItems={false}
                renderItem={() => <StateProbe />}
            />,
            { createNodeMock: (element) => {
                if (String(element.type) === 'ScrollView') return nodes.scroller;
                return {
                    measure: (callback: (x: number, y: number, width: number, height: number) => void) => {
                        measurements.push((height) => callback(0, 0, 800, height));
                    },
                    setNativeProps: () => {},
                };
            } },
        );
    });
    if (!mounted || !context) throw new Error('Expected the shipped Fabric list to mount its initial rows');
    const screen = mounted as ReactTestRenderer;
    assertShippedNativeLegendRuntime(screen, readShippedNativeModuleFacts(LegendNative, Platform));
    const state = () => {
        if (!context) throw new Error('Expected the original list context');
        return context.state;
    };
    return {
        state,
        writes: nodes.scroller.scrollWrites,
        pendingMeasurements: () => measurements.length,
        // 复用原生尺寸变化入口，观测目标变化当轮，不直接改写目标或尺寸缓存。
        layoutViewport: async (height: number) => {
            let afterCallback: { writes: number; bootstrap?: Bootstrap | null } | undefined;
            await act(async () => {
                screen.root.findByType('ScrollView' as never).props.onLayout({
                    nativeEvent: { layout: { x: 0, y: 1, width: 800, height } },
                });
                const bootstrap = state().initialScrollSession?.bootstrap;
                afterCallback = { writes: nodes.scroller.scrollWrites.length, bootstrap: bootstrap && { ...bootstrap } };
            });
            return afterCallback!;
        },
        // 这是列表自身挂出的原计算入口，仅用于证明下一轮原计算足以完成缺失的交接。
        calculateAgain: async () => {
            await act(async () => { state().triggerCalculateItemsInView({ forceFullItemPositions: true }); });
        },
        // 延迟的原生回调保持原来的 generation 检查和真实 updateItemSizes 路径。
        measurePending: async (height: number, count = measurements.length) => {
            await act(async () => {
                for (const callback of measurements.splice(0, count)) callback(height);
            });
        },
        // 在原帧回调返回后、下一次 React layout effect 前观测本轮是否完成布局交接。
        nextFrame: async () => {
            const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
            if (!entry) throw new Error('Expected an existing Legend animation frame');
            frames.delete(entry[0]);
            let afterCallback: { layout: boolean; queued: boolean; bootstrap: boolean; writes: number } | undefined;
            await act(async () => {
                entry[1](Date.now());
                afterCallback = {
                    layout: Boolean(state().didContainersLayout),
                    queued: Boolean(state().queuedInitialLayout),
                    bootstrap: Boolean(state().initialScrollSession?.bootstrap),
                    writes: nodes.scroller.scrollWrites.length,
                };
            });
            return afterCallback!;
        },
    };
}

describe('shipped Fabric bootstrap layout-ready handoff', () => {
    it.skipIf(Platform.OS !== 'android')('commits measured stable bootstrap layout in the same pass that dispatches initial placement', async () => {
        const list = await mountBootstrapList();
        expect(list.pendingMeasurements()).toBeGreaterThan(0);
        expect(list.state().initialScrollSession?.bootstrap).toBeTruthy();
        expect(list.writes).toHaveLength(0);
        expect(Boolean(list.state().didContainersLayout)).toBe(false);

        // 测量未返回时，真实初始化帧不能派发定位或宣告布局完成。
        for (let pass = 0; pass < 3; pass += 1) await list.nextFrame();
        expect(list.writes).toHaveLength(0);
        expect(Boolean(list.state().didContainersLayout)).toBe(false);

        await list.measurePending(100);
        let dispatched: Awaited<ReturnType<typeof list.nextFrame>> | undefined;
        for (let pass = 0; pass < 12 && !dispatched; pass += 1) {
            const result = await list.nextFrame();
            if (result.writes > 0) dispatched = result;
            if (!dispatched && list.pendingMeasurements() > 0) await list.measurePending(100);
        }
        expect(dispatched, 'Measured stable bootstrap must reach the original native scroll dispatch').toBeDefined();
        expect(dispatched?.bootstrap).toBe(false);
        // 下一轮原计算能完成布局，区分“条件不足”与“成功派发后的交接被旧 suppress 标记跳过”。
        await list.calculateAgain();
        expect(list.state().didContainersLayout).toBe(true);
        expect(dispatched?.layout, 'The ready bootstrap pass must not wait for another calculateItemsInView to mark layout').toBe(true);
        expect(dispatched?.queued).toBe(true);
        // 原生尚未回报已到目标；本修正不能把布局完成等同滚动完成。
        expect(Boolean(list.state().didFinishInitialScroll)).toBe(false);
    });

    it('does not dispatch a fully measured target in the same pass that viewport reflow changes it', async () => {
        const list = await mountBootstrapList();
        await list.measurePending(100);
        expect(list.writes).toHaveLength(0);
        const previousTarget = list.state().initialScrollSession?.bootstrap?.scroll;
        expect(previousTarget).toBeTypeOf('number');
        const changed = await list.layoutViewport(350);
        expect(changed.bootstrap).toBeTruthy();
        expect(changed.bootstrap?.scroll).not.toBe(previousTarget);
        expect(changed.writes).toBe(0);
        expect(Boolean(list.state().didContainersLayout)).toBe(false);
        // 可见与缓冲行都已由原生返回测量；等待来自目标稳定性，而不是缺测量。
        const state = list.state();
        for (let index = state.startBuffered; index <= state.endBuffered; index += 1) {
            expect(state.sizesKnown.has(state.idCache[index])).toBe(true);
        }
        await list.calculateAgain();
        expect(list.writes).toHaveLength(0);
        expect(Boolean(list.state().didContainersLayout)).toBe(false);
        expect(state.initialScrollSession?.bootstrap?.visibleIndices?.length).toBeGreaterThan(0);
        for (const index of state.initialScrollSession?.bootstrap?.visibleIndices ?? []) {
            expect(state.sizesKnown.has(state.idCache[index])).toBe(true);
        }
        for (let pass = 0; pass < 8 && list.writes.length === 0; pass += 1) await list.nextFrame();
        expect(list.writes.length).toBeGreaterThan(0);
        expect(list.state().initialScrollSession?.bootstrap).toBeFalsy();
    });
});
