import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    resolveCodexTopRouterRoot,
    shouldSkipOfficialUnistyles,
} = require('./resolveCodexTopRouterRoot.cjs') as {
    resolveCodexTopRouterRoot: (input: {
        previewSwitch: string | undefined;
        logicalVariant: string | undefined;
        devRuntime: boolean;
    }) => string;
    shouldSkipOfficialUnistyles: (input: {
        embeddedRouterRoot: string | undefined;
        devRuntime: boolean;
    }) => boolean;
};

const OFFICIAL_ROOT = './sources/app';
const PREVIEW_ROOT = './sources/dev/codexTopPreview/app';

describe('resolveCodexTopRouterRoot', () => {
    it('keeps the official router root when the preview switch is off', () => {
        expect(resolveCodexTopRouterRoot({
            previewSwitch: undefined,
            logicalVariant: 'development',
            devRuntime: true,
        })).toBe(OFFICIAL_ROOT);
        expect(resolveCodexTopRouterRoot({
            previewSwitch: '0',
            logicalVariant: 'development',
            devRuntime: true,
        })).toBe(OFFICIAL_ROOT);
    });

    it('selects the preview root only when the switch, development variant, and dev runtime all hold', () => {
        expect(resolveCodexTopRouterRoot({
            previewSwitch: '1',
            logicalVariant: 'development',
            devRuntime: true,
        })).toBe(PREVIEW_ROOT);
    });

    it('refuses the preview root outside development or a dev runtime', () => {
        expect(resolveCodexTopRouterRoot({
            previewSwitch: '1',
            logicalVariant: 'preview',
            devRuntime: true,
        })).toBe(OFFICIAL_ROOT);
        expect(resolveCodexTopRouterRoot({
            previewSwitch: '1',
            logicalVariant: 'production',
            devRuntime: true,
        })).toBe(OFFICIAL_ROOT);
        expect(resolveCodexTopRouterRoot({
            previewSwitch: '1',
            logicalVariant: 'development',
            devRuntime: false,
        })).toBe(OFFICIAL_ROOT);
    });
});

describe('shouldSkipOfficialUnistyles', () => {
    it('skips official unistyles only for the embedded preview root in a dev runtime', () => {
        expect(shouldSkipOfficialUnistyles({
            embeddedRouterRoot: PREVIEW_ROOT,
            devRuntime: true,
        })).toBe(true);
        expect(shouldSkipOfficialUnistyles({
            embeddedRouterRoot: PREVIEW_ROOT,
            devRuntime: false,
        })).toBe(false);
        expect(shouldSkipOfficialUnistyles({
            embeddedRouterRoot: OFFICIAL_ROOT,
            devRuntime: true,
        })).toBe(false);
    });
});
