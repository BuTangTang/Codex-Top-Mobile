import { describe, expect, it } from 'vitest';
import type { DirectSessionStatusGetResponse } from '@happier-dev/protocol';
import { resolveDirectSessionObservationStatus } from './resolveDirectSessionObservationStatus';

type Status = Extract<DirectSessionStatusGetResponse, { ok: true }>;

describe('direct observation display', () => {
    it.each(['running', 'needs_input', 'completed', 'failed', 'cancelled', 'unknown'] as const)(
        'displays explicit %s as a lifecycle label only', (state) => {
            const status = { machineOnline: true, observation: { state } } as Status;
            expect(resolveDirectSessionObservationStatus(status).textKey).toBe(`directSessions.observation.${state}`);
        },
    );
    it.each([null, { machineOnline: true, activity: 'running' },
        { machineOnline: false, observation: { state: 'completed' } }])(
        'shows unknown for absent, legacy or disconnected state: %j', (status) => {
            expect(resolveDirectSessionObservationStatus(status as Status | null).textKey).toBe('directSessions.observation.unknown');
        },
    );
});
