import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);

function resolveSentryReactNativeVersion(): string {
    const packageJsonPath = require_.resolve('@sentry/react-native/package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
    return pkg.version;
}

describe('native Sentry replay initialization patch', () => {
    it('keeps the patch file aligned with the installed @sentry/react-native version', () => {
        const version = resolveSentryReactNativeVersion();
        const patchPath = resolve(
            __dirname,
            '../../../patches',
            `@sentry+react-native+${version}.patch`,
        );
        expect(existsSync(patchPath), `expected patch file at ${patchPath}`).toBe(true);

        const patchContent = readFileSync(patchPath, 'utf8');
        expect(patchContent).toContain('HAPPIER PATCH(sentry-replay-post-init-guard)');
        expect(patchContent).toContain('ios/RNSentryStart.m');
        expect(patchContent).toContain('-    [RNSentryReplay postInit];');
        expect(patchContent).toContain('+        [RNSentryReplay postInit];');

        const addedPostInitIndex = patchContent.indexOf('+        [RNSentryReplay postInit];');
        const precedingPatch = patchContent.slice(0, addedPostInitIndex);
        const guardIndex = Math.max(
            precedingPatch.lastIndexOf('+    if (options.sessionReplay.sessionSampleRate > 0'),
            precedingPatch.lastIndexOf('+    if (isSessionReplayEnabled)'),
        );
        expect(guardIndex).toBeGreaterThan(-1);
        expect(patchContent).toContain('sessionReplay.onErrorSampleRate > 0');
    });
});
