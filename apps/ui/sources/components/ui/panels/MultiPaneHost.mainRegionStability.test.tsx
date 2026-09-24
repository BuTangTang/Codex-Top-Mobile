import * as React from 'react';
import { describe, expect, it } from 'vitest';
import renderer, { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';
import { MultiPaneHost } from './MultiPaneHost';


declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('MultiPaneHost (main region stability)', () => {
    it('keeps the main region mounted when a docked right pane opens and closes', async () => {
        const tracker = createMountTracker();
        const main = <Tracked tracker={tracker} name="main" />;

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(
            <MultiPaneHost
                main={main}
                rightPane={null}
                detailsPane={null}
                layout={{ kind: 'single', right: 'hidden', details: 'hidden' }}
                rightDockWidthPx={360}
                detailsDockWidthPx={520}
                onCloseRight={() => {}}
                onCloseDetails={() => {}}
                onCommitRightDockWidthPx={() => {}}
                onCommitDetailsDockWidthPx={() => {}}
            />,
        )).tree;

        expect(tracker.mounts.main).toBe(1);
        expect(tracker.unmounts.main ?? 0).toBe(0);

        act(() => {
            tree!.update(
                <MultiPaneHost
                    main={main}
                    rightPane={<Right />}
                    detailsPane={null}
                    layout={{ kind: 'twoPane', right: 'docked', details: 'hidden' }}
                    rightDockWidthPx={360}
                    detailsDockWidthPx={520}
                    onCloseRight={() => {}}
                    onCloseDetails={() => {}}
                    onCommitRightDockWidthPx={() => {}}
                    onCommitDetailsDockWidthPx={() => {}}
                />,
            );
        });

        expect(tracker.mounts.main).toBe(1);
        expect(tracker.unmounts.main ?? 0).toBe(0);

        act(() => {
            tree!.update(
                <MultiPaneHost
                    main={main}
                    rightPane={null}
                    detailsPane={null}
                    layout={{ kind: 'single', right: 'hidden', details: 'hidden' }}
                    rightDockWidthPx={360}
                    detailsDockWidthPx={520}
                    onCloseRight={() => {}}
                    onCloseDetails={() => {}}
                    onCommitRightDockWidthPx={() => {}}
                    onCommitDetailsDockWidthPx={() => {}}
                />,
            );
        });

        expect(tracker.mounts.main).toBe(1);
        expect(tracker.unmounts.main ?? 0).toBe(0);
    });
});

type MountTracker = {
    mounts: Record<string, number>;
    unmounts: Record<string, number>;
};

function createMountTracker(): MountTracker {
    return { mounts: {}, unmounts: {} };
}

function Tracked(props: Readonly<{ tracker: MountTracker; name: string }>) {
    React.useEffect(() => {
        props.tracker.mounts[props.name] = (props.tracker.mounts[props.name] ?? 0) + 1;
        return () => {
            props.tracker.unmounts[props.name] = (props.tracker.unmounts[props.name] ?? 0) + 1;
        };
    }, [props.name, props.tracker]);
    return React.createElement(props.name);
}

function Right() {
    return React.createElement('Right');
}
