import * as React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Deferred } from './Deferred';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('Deferred', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows a fallback during the defer window and swaps to children afterwards', async () => {
        vi.useFakeTimers();

        let screen!: ReturnType<typeof create>;
        await act(async () => {
            screen = create(
                <Deferred fallback={React.createElement('fallback', { testID: 'deferred-fallback' })}>
                    {React.createElement('child', { testID: 'deferred-child' })}
                </Deferred>,
            );
        });

        expect(screen.root.findAllByProps({ testID: 'deferred-fallback' })).toHaveLength(1);
        expect(screen.root.findAllByProps({ testID: 'deferred-child' })).toHaveLength(0);

        await act(async () => {
            vi.advanceTimersByTime(10);
        });

        expect(screen.root.findAllByProps({ testID: 'deferred-fallback' })).toHaveLength(0);
        expect(screen.root.findAllByProps({ testID: 'deferred-child' })).toHaveLength(1);
    });

    it('shows children immediately when enabled flips true before the defer timer', async () => {
        vi.useFakeTimers();

        let screen!: ReturnType<typeof create>;
        await act(async () => {
            screen = create(
                <Deferred enabled={false} fallback={React.createElement('fallback', { testID: 'deferred-fallback' })}>
                    {React.createElement('child', { testID: 'deferred-child' })}
                </Deferred>,
            );
        });

        expect(screen.root.findAllByProps({ testID: 'deferred-fallback' })).toHaveLength(1);
        expect(screen.root.findAllByProps({ testID: 'deferred-child' })).toHaveLength(0);

        await act(async () => {
            screen.update(
                <Deferred enabled={true} fallback={React.createElement('fallback', { testID: 'deferred-fallback' })}>
                    {React.createElement('child', { testID: 'deferred-child' })}
                </Deferred>,
            );
        });

        expect(screen.root.findAllByProps({ testID: 'deferred-fallback' })).toHaveLength(0);
        expect(screen.root.findAllByProps({ testID: 'deferred-child' })).toHaveLength(1);
    });
});
