import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { MMKV } from 'react-native-mmkv';

import { getLatestVersion } from '@/changelog';
import { getLegacyChangelogAutoSeenBaseline } from '@/changelog/releaseNotes/storage';
import { renderScreen } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHANGELOG_LAST_VIEWED_VERSION_KEY = 'changelog-last-viewed-version';

type ChangelogSnapshot = Readonly<{
    hasUnread: boolean;
    latestVersion: number;
}>;

describe('useChangelog', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    const previousDeny = process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;

    beforeEach(() => {
        vi.resetModules();
        new MMKV().clearAll();
        delete process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
    });

    afterEach(() => {
        if (tree) {
            act(() => {
                tree?.unmount();
            });
            tree = null;
        }

        if (previousDeny === undefined) {
            delete process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
        } else {
            process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = previousDeny;
        }
    });

    it('records when it auto-marks old changelog entries as read on first install', async () => {
        const { useChangelog } = await import('./useChangelog');
        const latestVersion = getLatestVersion();
        let latest: ChangelogSnapshot | null = null;

        function Probe() {
            const value = useChangelog();
            latest = {
                hasUnread: value.hasUnread,
                latestVersion: value.latestVersion,
            };
            return React.createElement('View');
        }

        tree = (await renderScreen(React.createElement(Probe))).tree;

        expect(latest).toEqual({ hasUnread: false, latestVersion });
        expect(new MMKV().getNumber(CHANGELOG_LAST_VIEWED_VERSION_KEY)).toBe(latestVersion);
        expect(getLegacyChangelogAutoSeenBaseline()).toBe(String(latestVersion));
    });
});
