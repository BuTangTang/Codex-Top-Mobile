import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TERMINAL_SHIFT_TAB_SEQUENCE } from '@/integrations/terminalHost/controlTypes';

import { createFakeControlPort } from './fakeControlPort';
import { applyPermissionModeControl } from './permissionMode';
import { applyModelControl } from './slashControls';
import { createClaudeSettingsGuard } from './settingsGuard';
import { DEFAULT_CLAUDE_TUI_CONTROL_TIMINGS } from './types';
import type { ControlRuntime } from './controlRuntime';
import type { FakeControlPort } from './fakeControlPort';

const HERE = __dirname;

/** Drop comment lines so fences target real code, not doc-comments describing the fenced patterns. */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !(trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*'));
    })
    .join('\n');
}

async function readControllerSources(): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(HERE);
  const files = entries.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'fakeControlPort.ts');
  return Promise.all(files.map(async (file) => ({ file, source: stripCommentLines(await readFile(join(HERE, file), 'utf8')) })));
}

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function runtimeFor(port: FakeControlPort): ControlRuntime {
  return { port, wait: async () => undefined, timings: DEFAULT_CLAUDE_TUI_CONTROL_TIMINGS, nowMs: () => 0 };
}

describe('B14 deletion fences — behavioral', () => {
  it('permission/plan mode cycling uses raw ShiftTab and never types /permissions', async () => {
    const PLAN = ['╭─╮', '│ >│', '╰─╯', '  ⏸ plan mode on (shift+tab to cycle)'].join('\n');
    const DEFAULT = ['╭─╮', '│ >│', '╰─╯', '  ? for shortcuts'].join('\n');
    const port = createFakeControlPort({ captures: [DEFAULT, PLAN] });

    await applyPermissionModeControl({ runtime: runtimeFor(port) }, { permissionMode: 'plan' });

    expect(port.sentKeys).toContain('ShiftTab');
    expect(port.sentLiteral).toHaveLength(0);
    expect(port.sentRaw).toHaveLength(0);
  });

  it('model control types /model (never /permissions)', async () => {
    const IDLE = ['╭─╮', '│ >│', '╰─╯'].join('\n');
    const OK = ['Set model to Sonnet 4.6', '╭─╮', '│ >│', '╰─╯'].join('\n');
    const port = createFakeControlPort({ captures: [IDLE, IDLE, OK] });
    const dir = await mkdtemp(join(tmpdir(), 'fence-'));
    tempRoots.push(dir);
    await writeFile(join(dir, 'settings.json'), '{}');
    const guard = createClaudeSettingsGuard({ configDir: dir });

    await applyModelControl({ runtime: runtimeFor(port), settingsGuard: guard, reason: 'before_prompt' }, 'sonnet');

    expect(port.sentLiteral.every((text) => !text.startsWith('/permissions'))).toBe(true);
  });
});

describe('B14 deletion fences — source', () => {
  it('uses the raw CSI-Z ShiftTab sequence, not a named tmux S-Tab', () => {
    expect(TERMINAL_SHIFT_TAB_SEQUENCE).toBe('\u001b[Z');
  });

  it('never references a named tmux S-Tab key or /permissions as a mode setter in controller sources', async () => {
    for (const { file, source } of await readControllerSources()) {
      expect(source, `${file} must not send a named S-Tab key`).not.toMatch(/['"`]S-Tab['"`]/);
      expect(source, `${file} must not type /permissions`).not.toMatch(/['"`]\/permissions/);
    }
  });

  it('confines raw /model and /effort typing to the slashControls owner', async () => {
    for (const { file, source } of await readControllerSources()) {
      if (file === 'slashControls.ts') continue;
      expect(source, `${file} must not type /model directly`).not.toMatch(/['"`]\/model\b/);
      expect(source, `${file} must not type /effort directly`).not.toMatch(/['"`]\/effort\b/);
    }
  });
});
