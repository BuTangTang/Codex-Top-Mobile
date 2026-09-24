import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSettingsEntryModuleMocks();

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
});

async function renderProviderLimitsScreen() {
    sessionSettingsEntryState.options.featureEnabled = (featureId) => featureId === 'sessions.usageLimitRecovery';
    const mod = await import('@/app/(app)/settings/session/provider-limits');
    const ProviderLimitsSettingsScreen = mod.default;
    return await renderSettingsView(React.createElement(ProviderLimitsSettingsScreen));
}

function findResumePromptDropdown(screen: Awaited<ReturnType<typeof renderProviderLimitsScreen>>) {
    return screen.findAllByType('DropdownMenu' as any).find((node) =>
        node.props.itemTrigger?.itemProps?.testID === 'settings-session-usageLimitRecovery-resumePrompt-trigger');
}

type CustomPromptInputProps = Readonly<{
    value: string;
    onChangeText: (next: string) => void;
    onBlur: () => void;
}>;

// The settings harness mocks `Item` as a leaf node, so the inline TextInput is
// reachable only through the Item's subtitle element props.
function findCustomPromptInputProps(
    screen: Awaited<ReturnType<typeof renderProviderLimitsScreen>>,
): CustomPromptInputProps | null {
    const item = screen.root.findAll((node) =>
        node.props?.testID === 'settings-session-usageLimitRecovery-customResumePrompt')[0];
    const subtitle = item?.props?.subtitle as { props?: CustomPromptInputProps } | undefined;
    return subtitle?.props ?? null;
}

describe('Session provider limits settings (custom resume prompt)', () => {
    it('offers a custom option in the resume prompt picker and hides the input until selected', async () => {
        sessionSettingsEntryState.settingsState.usageLimitRecoverySettingsV1 = {
            v: 1,
            mode: 'ask',
            promptMode: 'standard',
            resumePromptMode: 'standard',
        };
        const screen = await renderProviderLimitsScreen();

        const dropdown = findResumePromptDropdown(screen);
        expect(dropdown).toBeTruthy();
        expect(dropdown?.props.items?.map((item: { id: string }) => item.id)).toEqual(['standard', 'custom', 'off']);
        expect(findCustomPromptInputProps(screen)).toBeNull();
    });

    it('shows the custom prompt input bound to the stored custom text when mode is custom', async () => {
        sessionSettingsEntryState.settingsState.usageLimitRecoverySettingsV1 = {
            v: 1,
            mode: 'auto_wait',
            promptMode: 'standard',
            resumePromptMode: 'custom',
            customResumePrompt: 'Pick the task back up.',
        };
        const screen = await renderProviderLimitsScreen();

        const input = findCustomPromptInputProps(screen);
        expect(input).toBeTruthy();
        expect(input?.value).toBe('Pick the task back up.');
    });

    it('selecting custom mode persists it while preserving the stored custom text', async () => {
        sessionSettingsEntryState.settingsState.usageLimitRecoverySettingsV1 = {
            v: 1,
            mode: 'auto_wait',
            promptMode: 'standard',
            resumePromptMode: 'standard',
            customResumePrompt: 'Keep going.',
        };
        const screen = await renderProviderLimitsScreen();

        const dropdown = findResumePromptDropdown(screen);
        await act(async () => {
            dropdown?.props.onSelect('custom');
        });

        expect(sessionSettingsEntryState.settingsState.usageLimitRecoverySettingsV1).toEqual({
            v: 1,
            mode: 'auto_wait',
            promptMode: 'standard',
            resumePromptMode: 'custom',
            customResumePrompt: 'Keep going.',
        });
    });

    it('commits trimmed custom prompt text into the account setting on blur', async () => {
        sessionSettingsEntryState.settingsState.usageLimitRecoverySettingsV1 = {
            v: 1,
            mode: 'auto_wait',
            promptMode: 'standard',
            resumePromptMode: 'custom',
        };
        const screen = await renderProviderLimitsScreen();

        const input = findCustomPromptInputProps(screen);
        expect(input).toBeTruthy();
        await act(async () => {
            input?.onChangeText('  Resume the plan exactly where it stopped.  ');
        });
        const updatedInput = findCustomPromptInputProps(screen);
        await act(async () => {
            updatedInput?.onBlur();
        });

        expect(sessionSettingsEntryState.settingsState.usageLimitRecoverySettingsV1).toEqual({
            v: 1,
            mode: 'auto_wait',
            promptMode: 'standard',
            resumePromptMode: 'custom',
            customResumePrompt: 'Resume the plan exactly where it stopped.',
        });
    });
});
