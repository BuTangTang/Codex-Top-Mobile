import { describe, expect, it } from 'vitest';

import { toWindowsExtendedLengthPathForFs } from './copyRuntimePayloadTree';

describe('toWindowsExtendedLengthPathForFs', () => {
    it('adds a long-path prefix for absolute drive paths on Windows', () => {
        expect(
            toWindowsExtendedLengthPathForFs('C:\\Users\\tester\\payload\\node_modules\\pkg\\package.json', 'win32'),
        ).toBe('\\\\?\\C:\\Users\\tester\\payload\\node_modules\\pkg\\package.json');
    });

    it('adds UNC long-path prefix for network shares on Windows', () => {
        expect(
            toWindowsExtendedLengthPathForFs('\\\\server\\share\\payload\\pkg\\index.mjs', 'win32'),
        ).toBe('\\\\?\\UNC\\server\\share\\payload\\pkg\\index.mjs');
    });

    it('keeps non-Windows paths unchanged', () => {
        expect(
            toWindowsExtendedLengthPathForFs('/tmp/payload/package.json', 'darwin'),
        ).toBe('/tmp/payload/package.json');
    });
});
