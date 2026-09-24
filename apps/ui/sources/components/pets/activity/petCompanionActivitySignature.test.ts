import { describe, expect, it } from 'vitest';

import { joinSignatureParts } from './petCompanionActivitySignature';

describe('joinSignatureParts', () => {
    it('distinguishes embedded separators from separate signature fields', () => {
        expect(joinSignatureParts(['a', 'b'])).not.toBe(joinSignatureParts(['a\u001fb']));
    });
});
