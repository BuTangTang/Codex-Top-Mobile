import { describe, expect, it } from 'vitest';

import { shouldAnimateNativePetCompanionFrame } from './nativePetFrameAnimationPolicy';

describe('shouldAnimateNativePetCompanionFrame', () => {
    it('keeps native companion status frames static when the pet is not being directly manipulated', () => {
        expect(shouldAnimateNativePetCompanionFrame({
            dragState: null,
            reactionState: null,
        })).toBe(false);
    });

    it('animates native companion frames during direct pet interactions', () => {
        expect(shouldAnimateNativePetCompanionFrame({
            dragState: 'running-right',
            reactionState: null,
        })).toBe(true);
        expect(shouldAnimateNativePetCompanionFrame({
            dragState: null,
            reactionState: 'jumping',
        })).toBe(true);
    });
});
