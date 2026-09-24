import { describe, expect, it, vi } from 'vitest';

import {
  KEYBOARD_NAVIGATION_DESKTOP_VIEWPORT,
  enableKeyboardShortcutsV2FromSettings,
  openKeyboardShortcutSettings,
} from './keyboard';

describe('ui e2e keyboard helpers', () => {
  it('uses an explicit desktop viewport for keyboard navigation specs', () => {
    expect(KEYBOARD_NAVIGATION_DESKTOP_VIEWPORT).toEqual({ width: 1440, height: 900 });
  });

  it('opens keyboard shortcut settings with HMR disabled', async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      getByTestId: vi.fn(() => ({
        waitFor: vi.fn(async () => undefined),
      })),
    };

    await openKeyboardShortcutSettings({
      page: page as never,
      uiBaseUrl: 'http://127.0.0.1:19006/',
    });

    expect(page.goto).toHaveBeenCalledWith(
      'http://127.0.0.1:19006/settings/keyboard?happier_hmr=0',
      { waitUntil: 'domcontentloaded', timeout: 180_000 },
    );
    expect(page.getByTestId).toHaveBeenCalledWith('settings-keyboard-shortcuts-screen');
  });

  it('enables registry and single-key settings through stable test ids', async () => {
    const clicks: string[] = [];
    const page = {
      getByTestId: vi.fn((testId: string) => ({
        click: vi.fn(async () => {
          clicks.push(testId);
        }),
      })),
    };

    await enableKeyboardShortcutsV2FromSettings({ page: page as never, singleKey: true });

    expect(clicks).toEqual([
      'settings-keyboard-shortcuts-enabled',
      'settings-keyboard-shortcuts-single-key-enabled',
    ]);
  });
});
