import { describe, expect, it } from 'vitest';

import { resolveSessionResumeMachineTarget } from './sessionResumeMachineTarget';

describe('resolveSessionResumeMachineTarget', () => {
    it('uses the validated control target for resume machine routing', () => {
        expect(resolveSessionResumeMachineTarget({
            machineId: 'm-current',
            basePath: '/Users/test/workspace/repo',
            confidence: 'reachable',
        })).toEqual({
            machineId: 'm-current',
            directory: '/Users/test/workspace/repo',
        });
    });

    it('does not fall back to stale session metadata when no control target exists', () => {
        expect(resolveSessionResumeMachineTarget(null)).toBeNull();
    });
});
