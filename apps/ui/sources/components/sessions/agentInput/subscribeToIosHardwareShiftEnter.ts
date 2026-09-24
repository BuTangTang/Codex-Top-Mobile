import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type { NativeHardwareKeyboardAllowlist } from '@/keyboard/runtime';

export type NativeHardwareKeyboardEvent = Readonly<{
    key: string;
    code?: string;
    characters?: string;
    modifiers: Readonly<{
        shift: boolean;
        ctrl: boolean;
        meta: boolean;
        alt: boolean;
    }>;
    repeat: boolean;
    target: string;
}>;

type HappierHardwareKeyboardShortcutsModule = {
    addListener: {
        (eventName: 'hardwareKey', listener: (event: NativeHardwareKeyboardEvent) => void): { remove(): void };
        (eventName: 'shiftEnter', listener: () => void): { remove(): void };
    };
    setHardwareKeyEventsEnabled?: (enabled: boolean, allowlist?: NativeHardwareKeyboardAllowlist) => void;
    setShiftEnterEnabled?: (enabled: boolean) => void;
};

type NativeHardwareKeyboardSubscriptionOptions = NativeHardwareKeyboardAllowlist;

const activeHardwareKeySubscriptionOptions = new Map<number, NativeHardwareKeyboardSubscriptionOptions>();
let nextHardwareKeySubscriptionId = 1;

function readNativeModule(): HappierHardwareKeyboardShortcutsModule | null {
    return Platform.OS === 'ios' || Platform.OS === 'android'
        ? (requireOptionalNativeModule('HappierHardwareKeyboardShortcuts') as HappierHardwareKeyboardShortcutsModule | null)
        : null;
}

function mergeAllowlists(): NativeHardwareKeyboardAllowlist | undefined {
    const byKey = new Map<string, NativeHardwareKeyboardAllowlist['allowedEvents'][number]>();
    for (const options of activeHardwareKeySubscriptionOptions.values()) {
        for (const event of options.allowedEvents) {
            byKey.set([
                event.key,
                event.modifiers.shift,
                event.modifiers.ctrl,
                event.modifiers.meta,
                event.modifiers.alt,
            ].join(':'), event);
        }
    }
    const allowedEvents = Array.from(byKey.values());
    return allowedEvents.length > 0 ? { allowedEvents } : undefined;
}

function setHardwareKeyEventsEnabled(nativeModule: HappierHardwareKeyboardShortcutsModule, enabled: boolean): void {
    if (nativeModule.setHardwareKeyEventsEnabled) {
        nativeModule.setHardwareKeyEventsEnabled(enabled, enabled ? mergeAllowlists() : undefined);
    }
}

export function subscribeToNativeHardwareKeyboardEvents(
    listener: (event: NativeHardwareKeyboardEvent) => void,
    options: NativeHardwareKeyboardSubscriptionOptions,
): { remove(): void } | null {
    const nativeModule = readNativeModule();
    if (!nativeModule?.setHardwareKeyEventsEnabled) {
        return null;
    }
    if (options.allowedEvents.length === 0) {
        return null;
    }

    const subscription = nativeModule.addListener('hardwareKey', listener);
    const subscriptionId = nextHardwareKeySubscriptionId;
    nextHardwareKeySubscriptionId += 1;
    activeHardwareKeySubscriptionOptions.set(subscriptionId, options);
    setHardwareKeyEventsEnabled(nativeModule, true);

    let removed = false;

    return {
        remove: () => {
            if (removed) {
                return;
            }
            removed = true;
            subscription.remove();
            activeHardwareKeySubscriptionOptions.delete(subscriptionId);
            setHardwareKeyEventsEnabled(nativeModule, activeHardwareKeySubscriptionOptions.size > 0);
        },
    };
}

export function subscribeToIosHardwareShiftEnter(listener: () => void): { remove(): void } | null {
    const nativeModule = readNativeModule();
    if (!nativeModule?.setShiftEnterEnabled) {
        return null;
    }

    // Legacy composer wiring owns only pure Shift+Enter. Generic shortcut consumers
    // must subscribe through subscribeToNativeHardwareKeyboardEvents separately.
    const subscription = nativeModule.addListener('shiftEnter', listener);
    nativeModule.setShiftEnterEnabled(true);

    return {
        remove: () => {
            nativeModule.setShiftEnterEnabled?.(false);
            subscription.remove();
        },
    };
}
