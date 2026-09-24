import type { ThemePreference } from '@/components/ui/layout/statusBarStyle';

import { commitWebThemeMutation } from './commitWebThemeMutation';
import {
    THEME_TRANSITION_DURATION_MS,
    THEME_TRANSITION_EASING,
} from './themePreferenceTransitionMotion';

export type ThemeTransitionPlatform = 'web' | 'ios' | 'android' | 'native' | string;

export interface NativeThemePreferenceTransitionController {
    run: (mutation: () => void) => Promise<void> | void;
}

interface WebThemeTransitionDocument {
    documentElement: {
        animate?: (
            keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
            options?: number | KeyframeAnimationOptions,
        ) => Animation;
    };
    startViewTransition?: (update: () => void | Promise<void>) => {
        ready?: Promise<unknown>;
    };
}

export interface ThemePreferenceChangeInput {
    currentPreference: ThemePreference;
    nextPreference: ThemePreference;
    platform: ThemeTransitionPlatform;
    reduceMotion: boolean;
    forceAnimate?: boolean;
    systemTheme: 'light' | 'dark' | null | undefined;
    mutation: () => void;
    nativeController?: NativeThemePreferenceTransitionController | null;
    webDocument?: WebThemeTransitionDocument | null;
    webMutationCommit?: (mutation: () => void) => Promise<void> | void;
}

let registeredNativeController: NativeThemePreferenceTransitionController | null = null;

function resolveThemePreferenceVisualTheme(
    preference: ThemePreference,
    systemTheme: 'light' | 'dark' | null | undefined,
): 'light' | 'dark' {
    if (preference === 'adaptive') {
        return systemTheme === 'dark' ? 'dark' : 'light';
    }
    return preference;
}

export function registerNativeThemePreferenceTransitionController(
    controller: NativeThemePreferenceTransitionController | null,
): () => void {
    registeredNativeController = controller;
    return () => {
        if (registeredNativeController === controller) {
            registeredNativeController = null;
        }
    };
}

export function shouldAnimateThemePreferenceChange(input: Omit<ThemePreferenceChangeInput, 'mutation' | 'nativeController' | 'webDocument'>): boolean {
    if (input.reduceMotion) return false;
    if (input.forceAnimate) return true;
    const currentVisualTheme = resolveThemePreferenceVisualTheme(input.currentPreference, input.systemTheme);
    const nextVisualTheme = resolveThemePreferenceVisualTheme(input.nextPreference, input.systemTheme);
    return currentVisualTheme !== nextVisualTheme;
}

export async function runThemePreferenceChange(input: ThemePreferenceChangeInput): Promise<void> {
    if (!shouldAnimateThemePreferenceChange(input)) {
        input.mutation();
        return;
    }

    if (input.platform === 'web') {
        const webDocument = input.webDocument ?? (typeof document === 'undefined' ? null : document);
        if (!webDocument?.startViewTransition) {
            input.mutation();
            return;
        }

        const commitMutation = input.webMutationCommit ?? commitWebThemeMutation;
        const transition = webDocument.startViewTransition(() => commitMutation(input.mutation));
        await transition.ready?.catch(() => undefined);
        webDocument.documentElement.animate?.(
            { clipPath: ['inset(0 0 100% 0)', 'inset(0)'] },
            {
                duration: THEME_TRANSITION_DURATION_MS,
                easing: THEME_TRANSITION_EASING,
                fill: 'both',
                pseudoElement: '::view-transition-new(root)',
            },
        );
        return;
    }

    const controller = input.nativeController ?? registeredNativeController;
    if (!controller) {
        input.mutation();
        return;
    }

    let didMutate = false;
    try {
        await controller.run(() => {
            didMutate = true;
            input.mutation();
        });
    } catch {
        if (!didMutate) {
            input.mutation();
        }
    }
}
