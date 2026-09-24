import { describe, expect, it } from 'vitest';

import { buildSessionFileDeepLink, parseSessionFileDeepLinkAnchor } from './sessionFileDeepLink';

describe('sessionFileDeepLink', () => {
    it('builds a stable fileLine anchor URL and parses it back', () => {
        const url = buildSessionFileDeepLink({
            sessionId: 's1',
            filePath: 'src/foo.ts',
            source: 'file',
            anchor: { kind: 'fileLine', startLine: 12, lineHash: 'lh1:1234567890abcdef' },
        });

        expect(url).toBe('/session/s1/file?path=src%2Ffoo.ts&source=file&anchor=fileLine&startLine=12&lineHash=lh1%3A1234567890abcdef');

        const parsed = parseSessionFileDeepLinkAnchor({
            source: 'file',
            anchor: 'fileLine',
            startLine: '12',
            lineHash: 'lh1:1234567890abcdef',
        });
        expect(parsed).toEqual({ source: 'file', anchor: { kind: 'fileLine', startLine: 12, lineHash: 'lh1:1234567890abcdef' } });
    });

    it('builds a stable diffLine anchor URL and parses it back', () => {
        const url = buildSessionFileDeepLink({
            sessionId: 's1',
            filePath: 'src/foo.ts',
            source: 'diff',
            anchor: { kind: 'diffLine', startLine: 10, side: 'after', oldLine: 3, newLine: 4, lineHash: 'lh1:abcdef1234567890' },
        });

        expect(url).toBe('/session/s1/file?path=src%2Ffoo.ts&source=diff&anchor=diffLine&startLine=10&side=after&oldLine=3&newLine=4&lineHash=lh1%3Aabcdef1234567890');

        const parsed = parseSessionFileDeepLinkAnchor({
            source: 'diff',
            anchor: 'diffLine',
            startLine: '10',
            side: 'after',
            oldLine: '3',
            newLine: '4',
            lineHash: 'lh1:abcdef1234567890',
        });
        expect(parsed).toEqual({
            source: 'diff',
            anchor: { kind: 'diffLine', startLine: 10, side: 'after', oldLine: 3, newLine: 4, lineHash: 'lh1:abcdef1234567890' },
        });
    });

    it('builds normalized line anchor URLs and parses them back', () => {
        const url = buildSessionFileDeepLink({
            sessionId: 's1',
            filePath: 'src/foo.ts',
            source: 'file',
            anchor: { kind: 'line', filePath: 'src/foo.ts', line: 12, lineHash: 'lh1:1234567890abcdef' },
        });

        expect(url).toBe('/session/s1/file?path=src%2Ffoo.ts&source=file&anchor=line&line=12&lineHash=lh1%3A1234567890abcdef');

        const parsed = parseSessionFileDeepLinkAnchor({
            source: 'file',
            anchor: 'line',
            line: '12',
            lineHash: 'lh1:1234567890abcdef',
        });
        expect(parsed).toEqual({ source: 'file', anchor: { kind: 'line', filePath: '', line: 12, lineHash: 'lh1:1234567890abcdef' } });
    });

    it('builds normalized range anchor URLs and parses them back', () => {
        const url = buildSessionFileDeepLink({
            sessionId: 's1',
            filePath: 'src/foo.ts',
            source: 'diff',
            anchor: {
                kind: 'range',
                filePath: 'src/foo.ts',
                startLine: 10,
                endLine: 12,
                side: 'after',
                startLineHash: 'lh1:abcdef1234567890',
                endLineHash: 'lh1:0123456789abcdef',
            },
        });

        expect(url).toBe('/session/s1/file?path=src%2Ffoo.ts&source=diff&anchor=range&startLine=10&endLine=12&side=after&startLineHash=lh1%3Aabcdef1234567890&endLineHash=lh1%3A0123456789abcdef');

        const parsed = parseSessionFileDeepLinkAnchor({
            source: 'diff',
            anchor: 'range',
            startLine: '10',
            endLine: '12',
            side: 'after',
            startLineHash: 'lh1:abcdef1234567890',
            endLineHash: 'lh1:0123456789abcdef',
        });
        expect(parsed).toEqual({
            source: 'diff',
            anchor: {
                kind: 'range',
                filePath: '',
                startLine: 10,
                endLine: 12,
                side: 'after',
                startLineHash: 'lh1:abcdef1234567890',
                endLineHash: 'lh1:0123456789abcdef',
            },
        });
    });
});
