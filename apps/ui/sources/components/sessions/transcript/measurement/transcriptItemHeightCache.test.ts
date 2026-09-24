import { beforeEach, describe, expect, it } from 'vitest';

import {
    __resetDefaultTranscriptItemHeightCacheForTests,
    buildTranscriptItemHeightSignatureKey,
    createTestTranscriptItemHeightCache,
    getDefaultTranscriptItemHeightCache,
    type TranscriptItemHeightValiditySignature,
} from './transcriptItemHeightCache';

function stableSignature(
    overrides: Partial<TranscriptItemHeightValiditySignature> = {},
): TranscriptItemHeightValiditySignature {
    return {
        itemId: 'message-1',
        kind: 'agent-text',
        structuralKey: 'message-1:content-v1',
        widthBucket: 'width:400',
        fontScaleKey: 'font:1',
        groupingMode: 'turn',
        forkContextKey: 'root',
        expansionKey: 'tools:collapsed',
        rowState: 'stable',
        ...overrides,
    };
}

describe('transcriptItemHeightCache', () => {
    beforeEach(() => {
        __resetDefaultTranscriptItemHeightCacheForTests();
    });

    it('keys entries by the full validity signature', () => {
        const cache = createTestTranscriptItemHeightCache();
        const original = stableSignature();
        const differentWidth = stableSignature({ widthBucket: 'width:640' });

        cache.set(original, { heightPx: 144 });

        expect(buildTranscriptItemHeightSignatureKey(original)).not.toBe(
            buildTranscriptItemHeightSignatureKey(differentWidth),
        );
        expect(cache.get(original)?.heightPx).toBe(144);
        expect(cache.get(differentWidth)).toBeUndefined();
    });

    it('keeps signature keys unambiguous when fields contain separators', () => {
        const first = stableSignature({
            itemId: 'message:1',
            kind: 'agent|text',
            structuralKey: 'revision:1|width:400',
        });
        const second = stableSignature({
            itemId: 'message',
            kind: '1|agent',
            structuralKey: 'text:revision|1:width:400',
        });

        expect(buildTranscriptItemHeightSignatureKey(first)).not.toBe(
            buildTranscriptItemHeightSignatureKey(second),
        );
    });

    it('ignores stale message structural signatures', () => {
        const cache = createTestTranscriptItemHeightCache();
        const previous = stableSignature({ structuralKey: 'message-1:content-v1' });
        const stale = stableSignature({ structuralKey: 'message-1:content-v2' });

        cache.set(previous, { heightPx: 160 });

        expect(cache.get(stale)).toBeUndefined();
    });

    it('does not store active rows as stable height entries', () => {
        const cache = createTestTranscriptItemHeightCache();
        const unstableStates: ReadonlyArray<TranscriptItemHeightValiditySignature['rowState']> = [
            'streaming',
            'thinking',
            'pending-action',
            'tool-progress',
        ];

        for (const rowState of unstableStates) {
            const signature = stableSignature({ itemId: `message-${rowState}`, rowState });
            expect(cache.set(signature, { heightPx: 120 })).toBe(false);
            expect(cache.get(signature)).toBeUndefined();
        }
    });

    it('rejects signatures with empty dimension or sentinel keys', () => {
        const cache = createTestTranscriptItemHeightCache();
        const invalidSignatures: ReadonlyArray<TranscriptItemHeightValiditySignature> = [
            stableSignature({ widthBucket: '' }),
            stableSignature({ fontScaleKey: '' }),
            stableSignature({ forkContextKey: '' }),
            stableSignature({ expansionKey: '' }),
        ];

        for (const signature of invalidSignatures) {
            expect(cache.set(signature, { heightPx: 120 })).toBe(false);
            expect(cache.get(signature)).toBeUndefined();
        }
    });

    it('evicts the least recently used entry when the cache exceeds its cap', () => {
        const cache = createTestTranscriptItemHeightCache({ maxEntries: 2 });
        const a = stableSignature({ itemId: 'a', structuralKey: 'a:v1' });
        const b = stableSignature({ itemId: 'b', structuralKey: 'b:v1' });
        const c = stableSignature({ itemId: 'c', structuralKey: 'c:v1' });

        cache.set(a, { heightPx: 100 });
        cache.set(b, { heightPx: 110 });
        expect(cache.get(a)?.heightPx).toBe(100);
        cache.set(c, { heightPx: 120 });

        expect(cache.get(b)).toBeUndefined();
        expect(cache.get(a)?.heightPx).toBe(100);
        expect(cache.get(c)?.heightPx).toBe(120);
    });

    it('deletes one stable signature without clearing unrelated measured rows', () => {
        const cache = createTestTranscriptItemHeightCache();
        const a = stableSignature({ itemId: 'a', structuralKey: 'a:v1' });
        const b = stableSignature({ itemId: 'b', structuralKey: 'b:v1' });
        cache.set(a, { heightPx: 100 });
        cache.set(b, { heightPx: 120 });

        expect(cache.delete(a)).toBe(true);

        expect(cache.get(a)).toBeUndefined();
        expect(cache.get(b)?.heightPx).toBe(120);
        expect(cache.delete(a)).toBe(false);
    });

    it('returns isolated test cache instances', () => {
        const a = createTestTranscriptItemHeightCache();
        const b = createTestTranscriptItemHeightCache();

        a.set(stableSignature(), { heightPx: 128 });

        expect(b.get(stableSignature())).toBeUndefined();
    });

    it('resets the default singleton for tests', () => {
        const first = getDefaultTranscriptItemHeightCache({ maxEntries: 8 });
        first.set(stableSignature(), { heightPx: 192 });

        __resetDefaultTranscriptItemHeightCacheForTests();
        const second = getDefaultTranscriptItemHeightCache({ maxEntries: 8 });

        expect(second).not.toBe(first);
        expect(second.get(stableSignature())).toBeUndefined();
    });
});
