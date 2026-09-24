import type { Page } from '@playwright/test';

export const KEYBOARD_NAVIGATION_DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function openKeyboardShortcutSettings(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
}>): Promise<void> {
  const url = `${trimTrailingSlash(params.uiBaseUrl)}/settings/keyboard?happier_hmr=0`;
  await params.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await params.page.getByTestId('settings-keyboard-shortcuts-screen').waitFor({ timeout: 60_000 });
}

export async function enableKeyboardShortcutsV2FromSettings(params: Readonly<{
  page: Page;
  singleKey?: boolean;
}>): Promise<void> {
  await params.page.getByTestId('settings-keyboard-shortcuts-enabled').click();
  if (params.singleKey === true) {
    await params.page.getByTestId('settings-keyboard-shortcuts-single-key-enabled').click();
  }
}
