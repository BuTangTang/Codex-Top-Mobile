import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const flashListState = vi.hoisted(() => ({
    props: null as Record<string, unknown> | null,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: <T,>(options: { ios?: T; native?: T; default?: T; web?: T; android?: T }) =>
                options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
        },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/components/ui/lists/flashListCompat/FlashListCompat', async () => {
    const ReactModule = await import('react');
    return {
        FlashList: ReactModule.forwardRef((props: Record<string, unknown>, ref) => {
            flashListState.props = props;
            if (ref && typeof ref === 'object') {
                ref.current = { scrollToOffset: () => {}, scrollToIndex: () => {} };
            }
            return ReactModule.createElement('FlashList');
        }),
    };
});

vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({
    ActivitySpinner: () => React.createElement('ActivitySpinner'),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children }: { children?: React.ReactNode }) => React.createElement('Text', null, children),
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
    },
}));

describe('FilesystemBrowserList native virtualization', () => {
    it('uses FlashList on native for large file-tree lists', async () => {
        const { FilesystemBrowserList } = await import('./FilesystemBrowserList');

        await renderScreen(
            <FilesystemBrowserList
                nodes={[
                    { type: 'file', path: 'src/a.ts', name: 'a.ts', depth: 0, isExpanded: false, isLoadingChildren: false },
                    { type: 'file', path: 'src/b.ts', name: 'b.ts', depth: 0, isExpanded: false, isLoadingChildren: false },
                ]}
                rootLoading={false}
                rootError={null}
                loadingLabel="Loading"
                inlineRetryLabel="Retry"
                renderRow={({ node }) => React.createElement('Row', { path: node.path })}
                retryRoot={() => undefined}
            />,
        );

        expect(flashListState.props?.data).toHaveLength(2);
        expect(flashListState.props?.estimatedItemSize).toBeGreaterThan(0);
    });
});
