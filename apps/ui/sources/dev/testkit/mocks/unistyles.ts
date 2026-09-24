import type { PlainObject } from './_shared';
import { mergeObjects } from './_shared';
import { createThemeFixture, createThemeRuntimeFixture, type TestThemeRuntimeFixture } from '../fixtures/themeFixtures';

export type TestUnistylesOverrides = Readonly<{
    theme?: PlainObject;
    rt?: Partial<TestThemeRuntimeFixture>;
    runtime?: PlainObject;
}>;

function flattenStyle(style: unknown): unknown {
    if (style == null) return style;
    if (Array.isArray(style)) {
        return style.reduce<PlainObject>(
            (accumulator, entry) => ({ ...accumulator, ...(flattenStyle(entry) as PlainObject | null ?? {}) }),
            {},
        );
    }
    if (typeof style === 'number') return {};
    if (typeof style === 'object') return style;
    return {};
}

export async function createUnistylesMock(overrides?: TestUnistylesOverrides) {
    const theme = createThemeFixture(overrides?.theme);
    const rt = createThemeRuntimeFixture(overrides?.rt);
    const runtimeModule = mergeObjects(
        {
            setAdaptiveThemes: (..._args: unknown[]) => {},
            setTheme: (..._args: unknown[]) => {},
            updateTheme: (..._args: unknown[]) => {},
            setRootViewBackgroundColor: (..._args: unknown[]) => {},
        },
        overrides?.runtime,
    );

    return {
        useUnistyles: () => ({ theme, rt }),
        StyleSheet: {
            create: (input: unknown) =>
                typeof input === 'function'
                    ? (input as (theme: unknown, runtime: unknown) => unknown)(theme, rt)
                    : input,
            flatten: flattenStyle,
            configure: () => {},
            absoluteFillObject: {},
        },
        UnistylesRuntime: runtimeModule,
    };
}

export function installUnistylesMock(overrides?: TestUnistylesOverrides) {
    return async () => createUnistylesMock(overrides);
}
