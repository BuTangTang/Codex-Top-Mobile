import { describe, expect, it } from 'vitest';

import {
    getSessionLocalControlState,
    isSessionRemoteWritableWhileLocallyAttached,
} from './sessionLocalControl';
import type { Session } from '@/sync/domains/state/storageTypes';

describe('session local control state', () => {
    it('does not infer remote writeability from shared topology when the field is omitted', () => {
        const session = {
            agentState: {
                localControl: {
                    attached: true,
                    topology: 'shared',
                },
            },
        } as Session;

        expect(getSessionLocalControlState(session)).toMatchObject({
            attached: true,
            topology: 'shared',
            remoteWritable: false,
        });
        expect(isSessionRemoteWritableWhileLocallyAttached(session)).toBe(false);
    });

    it('preserves explicit provider-server writeability for shared attachment', () => {
        const session = {
            agentState: {
                localControl: {
                    attached: true,
                    topology: 'shared',
                    remoteWritable: true,
                },
            },
        } as Session;

        expect(getSessionLocalControlState(session)?.remoteWritable).toBe(true);
        expect(isSessionRemoteWritableWhileLocallyAttached(session)).toBe(true);
    });
});
