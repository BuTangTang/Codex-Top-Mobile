import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import {
    clearSessionListHeaderFilterRetentionForTests,
    useSessionListHeaderFilterRetention,
} from './useSessionListHeaderFilterRetention';

describe('useSessionListHeaderFilterRetention', () => {
    afterEach(() => {
        clearSessionListHeaderFilterRetentionForTests();
        standardCleanup();
    });

    it('retains durable header filters across remounts for the same key', async () => {
        const hook = await renderHook(
            ({ retentionKey }: { retentionKey: string }) => useSessionListHeaderFilterRetention(retentionKey),
            { initialProps: { retentionKey: 'sessions-list:all' } },
        );

        await act(async () => {
            hook.getCurrent().setSearchQuery('audit');
            hook.getCurrent().setSelectedHeaderTags(['important']);
        });
        await hook.unmount();

        const remounted = await renderHook(
            ({ retentionKey }: { retentionKey: string }) => useSessionListHeaderFilterRetention(retentionKey),
            { initialProps: { retentionKey: 'sessions-list:all' } },
        );

        expect(remounted.getCurrent().searchQuery).toBe('audit');
        expect(remounted.getCurrent().selectedHeaderTags).toEqual(['important']);
    });

    it('switches to the filters retained for a new key when the mounted surface key changes', async () => {
        const firstHook = await renderHook(
            ({ retentionKey }: { retentionKey: string }) => useSessionListHeaderFilterRetention(retentionKey),
            { initialProps: { retentionKey: 'sessions-list:all' } },
        );
        await act(async () => {
            firstHook.getCurrent().setSearchQuery('audit');
        });
        await firstHook.unmount();

        const secondHook = await renderHook(
            ({ retentionKey }: { retentionKey: string }) => useSessionListHeaderFilterRetention(retentionKey),
            { initialProps: { retentionKey: 'sessions-list:direct' } },
        );
        await act(async () => {
            secondHook.getCurrent().setSearchQuery('direct');
        });

        await secondHook.rerender({ retentionKey: 'sessions-list:all' });

        expect(secondHook.getCurrent().searchQuery).toBe('audit');
    });
});
