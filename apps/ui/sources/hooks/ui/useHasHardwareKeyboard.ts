import * as React from 'react';
import { Platform } from 'react-native';

/**
 * Heuristic: does the user have a hardware keyboard?
 *
 * - **Web**: true when `(pointer: fine)` matches AND `navigator.maxTouchPoints === 0`.
 *   The conjunction excludes touch laptops (fine pointer present, but the user is
 *   likely interacting via touch and won't see the chips/footer hints either way).
 * - **Native (v1)**: returns `false` unconditionally. Hardware-keyboard support on
 *   iOS/iPadOS/Android is owned by the keyboard plan's Phase 6.
 *
 * Used by SelectionList to suppress KeyChip + footer hint rendering when no
 * hardware keyboard is detected (the chips would be decorative noise on touch).
 */

// F8 — Narrow boundary types for the optional Web APIs we touch on
// `globalThis`. `react-native`'s shared bundle runs on web and native;
// `window` / `navigator` are not always present, and we only use a
// minimal slice of each surface. Keeping these structural avoids
// dragging in DOM lib types just for two optional fields.
type MediaQueryListLike = Readonly<{
    matches?: boolean;
    addEventListener?: (event: 'change', cb: () => void) => void;
    removeEventListener?: (event: 'change', cb: () => void) => void;
    addListener?: (cb: () => void) => void;
    removeListener?: (cb: () => void) => void;
}>;

type HardwareKeyboardWindow = Readonly<{
    matchMedia?: (query: string) => MediaQueryListLike | null | undefined;
}>;

type HardwareKeyboardNavigator = Readonly<{
    maxTouchPoints?: number;
}>;

function readWindow(): HardwareKeyboardWindow | undefined {
    return (globalThis as { window?: HardwareKeyboardWindow }).window;
}

function readNavigator(): HardwareKeyboardNavigator | undefined {
    return (globalThis as { navigator?: HardwareKeyboardNavigator }).navigator;
}

export function useHasHardwareKeyboard(): boolean {
    const [hasKeyboard, setHasKeyboard] = React.useState<boolean>(() => detectHasHardwareKeyboardSync());

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const win = readWindow();
        if (!win?.matchMedia) return;
        const query = win.matchMedia('(pointer: fine)');
        if (!query) return;
        const onChange = () => setHasKeyboard(detectHasHardwareKeyboardSync());
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', onChange);
            return () => query.removeEventListener?.('change', onChange);
        }
        if (typeof query.addListener === 'function') {
            query.addListener(onChange);
            return () => query.removeListener?.(onChange);
        }
        return undefined;
    }, []);

    return hasKeyboard;
}

function detectHasHardwareKeyboardSync(): boolean {
    if (Platform.OS !== 'web') return false;
    const win = readWindow();
    if (!win?.matchMedia) return false;
    const finePointer = Boolean(win.matchMedia('(pointer: fine)')?.matches);
    if (!finePointer) return false;
    const nav = readNavigator();
    const touchPoints = typeof nav?.maxTouchPoints === 'number'
        ? nav.maxTouchPoints
        : 0;
    return touchPoints === 0;
}
