import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as LegendNative from '@legendapp/list/react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { Platform, View } from 'react-native';

import {
    assertShippedNativeLegendRuntime,
    createShippedNativeNodeMock,
    readShippedNativeModuleFacts,
} from '@/dev/testkit/legend/shippedNativeLegendRuntime';

const ROW_HEIGHT = 100;
const ROW_COUNT = 10;
const VIEWPORT_HEIGHT = 400;
const FOOTER_HEIGHT = 64;
const CONTENT_HEIGHT = ROW_COUNT * ROW_HEIGHT + FOOTER_HEIGHT;
const PHYSICAL_MAX_OFFSET = CONTENT_HEIGHT - VIEWPORT_HEIGHT;
const FOOTER_TEST_ID = 'initial-end-physical-footer';
const DATA = Array.from({ length: ROW_COUNT }, (_, index) => ({ id: `synthetic-row-${index}` }));

type ScrollWrite = Readonly<{
    requested: number;
    contentLength: number | null;
    footerLaidOut: boolean;
}>;

let mounted: ReactTestRenderer | null = null;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    if (mounted) act(() => mounted?.unmount());
    mounted = null;
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

/** 只模拟原生测量、物理范围截断与滚动回调；目标计算和 footer 布局回调执行真实 Legend。 */
async function mountFooterList(initialAtEnd: boolean, footerAfterFirstCommand = false, options: Readonly<{
    initialFooterHeight?: number;
    measureRows?: boolean;
    nativeScrollDelayMs?: number;
}> = {}) {
    const ref = React.createRef<LegendListRef>();
    const nodes = createShippedNativeNodeMock({ rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT_HEIGHT });
    const writes: ScrollWrite[] = [];
    let footerLaidOut = false;
    let footerHeight = options.initialFooterHeight ?? FOOTER_HEIGHT;
    let contentHeight = ROW_COUNT * ROW_HEIGHT + footerHeight;
    const revealedOffsets: number[] = [];
    let physicalOffset = 0;
    let loadCount = 0;
    let screen: ReactTestRenderer | null = null;
    const originalScrollTo = nodes.scroller.scrollTo;
    vi.spyOn(nodes.scroller, 'scrollTo').mockImplementation((write) => {
        originalScrollTo(write);
        const requested = write.y ?? 0;
        writes.push({
            requested,
            contentLength: ref.current?.getState().contentLength ?? null,
            footerLaidOut,
        });
        // 原生内容只含十行与一个实测 footer，不能接受逻辑目标扩大的滚动范围。
        const nextOffset = Math.max(0, Math.min(contentHeight - VIEWPORT_HEIGHT, requested));
        if (nextOffset === physicalOffset) return;
        physicalOffset = nextOffset;
        setTimeout(() => {
            screen?.root.findByType('ScrollView' as never).props.onScroll({ nativeEvent: {
                contentOffset: { x: 0, y: nextOffset },
                contentSize: { width: 800, height: contentHeight },
                layoutMeasurement: { width: 800, height: VIEWPORT_HEIGHT },
                contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
            } });
        }, options.nativeScrollDelayMs ?? 0);
    });
    await act(async () => {
        screen = create(
            <LegendList
                data={DATA}
                estimatedItemSize={ROW_HEIGHT}
                getFixedItemSize={options.measureRows ? undefined : () => ROW_HEIGHT}
                initialScrollAtEnd={initialAtEnd}
                keyExtractor={(item) => item.id}
                ListFooterComponent={<View testID={FOOTER_TEST_ID} style={{ height: options.initialFooterHeight ?? FOOTER_HEIGHT }} />}
                onLoad={() => { loadCount += 1; revealedOffsets.push(physicalOffset); }}
                recycleItems={false}
                ref={ref}
                renderItem={({ item }) => <React.Fragment>{item.id}</React.Fragment>}
            />,
            { createNodeMock: (element) => {
                const child = (element.props as { children?: React.ReactNode }).children;
                if (React.isValidElement<{ testID?: string }>(child) && child.props.testID === FOOTER_TEST_ID) {
                    return {
                        // 首次 Fabric 测量尚未拿到 footer；随后走同一个宿主的真实 onLayout。
                        measure: (callback: (x: number, y: number, width: number, height: number) => void) =>
                            callback(0, 0, 800, footerLaidOut ? footerHeight : 0),
                        setNativeProps: () => {},
                    };
                }
                return nodes.createNodeMock(element);
            } },
        );
    });
    if (!screen || !ref.current) throw new Error('Expected the native Legend footer fixture to mount');
    const currentScreen = screen as ReactTestRenderer;
    mounted = currentScreen;
    assertShippedNativeLegendRuntime(currentScreen, readShippedNativeModuleFacts(LegendNative, Platform));
    await act(async () => {
        currentScreen.root.findByType('ScrollView' as never).props.onLayout({
            nativeEvent: { layout: { height: VIEWPORT_HEIGHT, width: 800, x: 0, y: 0 } },
        });
    });
    const footerWrapper = currentScreen.root.findAllByType('View' as never).find((node) => {
        const child = node.props.children;
        return typeof node.props.onLayout === 'function'
            && React.isValidElement<{ testID?: string }>(child)
            && child.props.testID === FOOTER_TEST_ID;
    });
    if (!footerWrapper) throw new Error('Expected the real Legend footer layout wrapper');
    if (footerAfterFirstCommand) {
        for (let frame = 0; frame < 80 && writes.length === 0; frame += 1) {
            await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
        }
        expect(writes.length).toBeGreaterThan(0);
        expect(writes.every((write) => !write.footerLaidOut)).toBe(true);
    }
    const loadsBeforeFooterLayout = loadCount;
    await act(async () => {
        footerLaidOut = true;
        footerWrapper.props.onLayout({
            nativeEvent: { layout: { height: footerHeight, width: 800, x: 0, y: 0 } },
        });
    });
    return {
        ref,
        writes,
        loadsBeforeFooterLayout,
        revealedOffsets,
        setFooterHeight: async (height: number) => {
            // 模拟原生 footer（例如键盘动画）完成新布局，仍调用同一个真实宿主回调。
            footerHeight = height;
            contentHeight = ROW_COUNT * ROW_HEIGHT + height;
            await act(async () => {
                footerWrapper.props.onLayout({ nativeEvent: { layout: { height, width: 800, x: 0, y: 0 } } });
            });
        },
        dragTo: async (offset: number) => {
            await act(async () => {
                const scroller = currentScreen.root.findByType('ScrollView' as never);
                scroller.props.onScrollBeginDrag({ nativeEvent: { contentOffset: { x: 0, y: physicalOffset } } });
                physicalOffset = offset;
                scroller.props.onScroll({ nativeEvent: {
                    contentOffset: { x: 0, y: offset },
                    contentSize: { width: 800, height: contentHeight },
                    layoutMeasurement: { width: 800, height: VIEWPORT_HEIGHT },
                    contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
                } });
            });
        },
        read: () => ({ loadCount, physicalOffset, contentLength: ref.current!.getState().contentLength }),
    };
}

/** 逐帧提交真实运行时产生的 React 更新，不替换滚动完成判断或推进内部状态。 */
async function settleFrames() {
    for (let frame = 0; frame < 80; frame += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(16); });
    }
}

describe('shipped Fabric initial-end footer geometry', () => {
    it.each([false, true])('keeps automatic initial-end targets within native range with footer after first command=%s', async (footerAfterFirstCommand) => {
        const list = await mountFooterList(true, footerAfterFirstCommand);
        expect(list.loadsBeforeFooterLayout).toBe(0);
        await settleFrames();
        expect(list.read()).toMatchObject({ loadCount: 1, contentLength: CONTENT_HEIGHT });
        // 保留原生静默重试的 1dp nudge 容差；本回归约束 footer 重复形成的额外目标。
        expect(Math.abs(list.read().physicalOffset - PHYSICAL_MAX_OFFSET)).toBeLessThanOrEqual(1);
        // 只审 footer 已实测且内容总高已同步后的命令，不把尺寸未就绪的暂态命令算作失败。
        const measuredWrites = list.writes.filter((write) => write.footerLaidOut && write.contentLength === CONTENT_HEIGHT);
        expect(measuredWrites.length).toBeGreaterThan(0);
        expect(measuredWrites.map((write) => write.requested).filter((offset) => offset > PHYSICAL_MAX_OFFSET + 1)).toEqual([]);
    });


    it('retargets a second footer growth after measured rows have dispatched the initial placement', async () => {
        const list = await mountFooterList(true, false, {
            initialFooterHeight: 54,
            measureRows: true,
            nativeScrollDelayMs: 40,
        });
        // 分帧提交真实行测量及 layout-ready 的下一帧派发；原生确认仍在途中。
        for (let frame = 0; frame < 2; frame += 1) {
            await act(async () => { await vi.advanceTimersByTimeAsync(16); });
        }
        expect(list.read()).toMatchObject({ loadCount: 0, contentLength: 1054 });
        expect(list.writes.some((write) => write.requested === 654 && write.contentLength === 1054)).toBe(true);
        const beforeGrowth = list.writes.length;
        await list.setFooterHeight(118);
        // 旧原生回调已到、新目标仍在途中；重复同高布局不应再派发同一目标。
        await act(async () => { await vi.advanceTimersByTimeAsync(8); });
        const beforeRepeatedLayout = list.writes.length;
        await list.setFooterHeight(118);
        expect(list.writes).toHaveLength(beforeRepeatedLayout);
        await settleFrames();
        expect(list.read()).toMatchObject({ loadCount: 1, contentLength: 1118 });
        expect(list.revealedOffsets).toHaveLength(1);
        expect(Math.abs(list.revealedOffsets[0] - 718)).toBeLessThanOrEqual(1);
        expect(Math.abs(list.read().physicalOffset - 718)).toBeLessThanOrEqual(1);
        expect(list.writes.slice(beforeGrowth).some((write) => Math.abs(write.requested - 718) <= 1)).toBe(true);
    });

    it.each(['cancel', 'leave-end'] as const)('does not reacquire initial placement after %s when the footer grows', async (takeover) => {
        const list = await mountFooterList(true, false, {
            initialFooterHeight: 54,
            measureRows: true,
            nativeScrollDelayMs: 40,
        });
        for (let frame = 0; frame < 2; frame += 1) {
            await act(async () => { await vi.advanceTimersByTimeAsync(16); });
        }
        expect(list.read().loadCount).toBe(0);
        if (takeover === 'cancel') {
            await act(async () => { list.ref.current!.cancelScroll(); });
        } else {
            await settleFrames();
            expect(list.read().loadCount).toBe(1);
            await list.dragTo(300);
        }
        const beforeGrowth = list.writes.length;
        await list.setFooterHeight(118);
        await settleFrames();
        expect(list.read().contentLength).toBe(1118);
        expect(list.writes.slice(beforeGrowth)).toEqual([]);
    });

    it('preserves a caller-specified negative viewOffset for an explicit item target', async () => {
        const list = await mountFooterList(false);
        await settleFrames();
        const beforeCommand = list.writes.length;
        await act(async () => {
            void list.ref.current!.scrollToIndex({ index: 4, viewPosition: 0, viewOffset: -80, animated: false });
        });
        await settleFrames();
        const commandedWrites = list.writes.slice(beforeCommand);
        expect(commandedWrites.length).toBeGreaterThan(0);
        expect(commandedWrites.at(-1)?.requested).toBe(4 * ROW_HEIGHT + 80);
        expect(list.read().physicalOffset).toBe(4 * ROW_HEIGHT + 80);
    });
});
