import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { SessionResumeProvider, useSessionResumeAction } from './SessionResumeContext';

describe('SessionResumeContext', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('keeps the context action identity stable while calling the latest resume handler', async () => {
        let renderCount = 0;
        const observedActionRef: { current: ReturnType<typeof useSessionResumeAction> } = { current: null };
        const Consumer = React.memo(function Consumer(): React.ReactElement | null {
            renderCount += 1;
            observedActionRef.current = useSessionResumeAction();
            return null;
        });
        const child = <Consumer />;
        const firstResume = vi.fn(async () => true);
        const secondResume = vi.fn(async () => false);

        const screen = await renderScreen(
            <SessionResumeProvider onResumeSession={firstResume}>
                {child}
            </SessionResumeProvider>,
        );
        const firstObservedAction = observedActionRef.current;

        await act(async () => {
            screen.tree.update(
                <SessionResumeProvider onResumeSession={secondResume}>
                    {child}
                </SessionResumeProvider>,
            );
        });

        expect(renderCount).toBe(1);
        expect(observedActionRef.current).toBe(firstObservedAction);
        const resume = observedActionRef.current;
        expect(resume).toBeTypeOf('function');
        if (!resume) throw new Error('expected resume action');
        await resume();
        expect(firstResume).not.toHaveBeenCalled();
        expect(secondResume).toHaveBeenCalledOnce();
    });
});
