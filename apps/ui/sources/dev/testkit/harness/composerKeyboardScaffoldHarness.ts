import type { ComposerKeyboardLayout, MockComposerKeyboardScaffoldProps } from '../mocks/keyboardAvoidance';

export type MockComposerKeyboardScaffoldRender = Readonly<{
    layout: ComposerKeyboardLayout;
    props: MockComposerKeyboardScaffoldProps;
}>;

export type MockComposerKeyboardScaffoldHarness = Readonly<{
    clear: () => void;
    getLastRender: () => MockComposerKeyboardScaffoldRender | null;
    recordRender: (render: MockComposerKeyboardScaffoldRender) => void;
}>;

export function createMockComposerKeyboardScaffoldHarness(): MockComposerKeyboardScaffoldHarness {
    let lastRender: MockComposerKeyboardScaffoldRender | null = null;

    return {
        clear: () => {
            lastRender = null;
        },
        getLastRender: () => lastRender,
        recordRender: (render) => {
            lastRender = render;
        },
    };
}
