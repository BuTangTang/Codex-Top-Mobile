import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildClaudeStatuslineOverlaySettings,
  resolveClaudeStatuslineOriginalCommand,
} from './buildClaudeStatuslineOverlay';

describe('resolveClaudeStatuslineOriginalCommand', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
      await cleanup();
    }
  });

  async function writeConfigRoot(settings: unknown): Promise<string> {
    const configRoot = await mkdtemp(join(tmpdir(), 'happier-statusline-config-'));
    cleanups.push(() => rm(configRoot, { recursive: true, force: true }));
    if (settings !== undefined) {
      await writeFile(join(configRoot, 'settings.json'), JSON.stringify(settings));
    }
    return configRoot;
  }

  it('reads the configured statusline command from the spawned config root settings', async () => {
    const configRoot = await writeConfigRoot({
      statusLine: { type: 'command', command: '~/.claude/statusline.sh', padding: 0 },
    });

    const original = resolveClaudeStatuslineOriginalCommand({
      env: { CLAUDE_CONFIG_DIR: configRoot },
    });

    expect(original).toEqual({ command: '~/.claude/statusline.sh', padding: 0 });
  });

  it('returns null when no statusline is configured, the type is not command, or the file is unreadable', async () => {
    const noStatusline = await writeConfigRoot({ permissions: {} });
    const wrongType = await writeConfigRoot({ statusLine: { type: 'static', text: 'hi' } });
    const missingFile = await writeConfigRoot(undefined);
    const garbage = await writeConfigRoot(undefined);
    await writeFile(join(garbage, 'settings.json'), 'not json {');

    expect(resolveClaudeStatuslineOriginalCommand({ env: { CLAUDE_CONFIG_DIR: noStatusline } })).toBeNull();
    expect(resolveClaudeStatuslineOriginalCommand({ env: { CLAUDE_CONFIG_DIR: wrongType } })).toBeNull();
    expect(resolveClaudeStatuslineOriginalCommand({ env: { CLAUDE_CONFIG_DIR: missingFile } })).toBeNull();
    expect(resolveClaudeStatuslineOriginalCommand({ env: { CLAUDE_CONFIG_DIR: garbage } })).toBeNull();
  });
});

describe('buildClaudeStatuslineOverlaySettings', () => {
  it('builds a command statusline wrapping the forwarder with port, private secret file, and the b64 original', () => {
    const overlay = buildClaudeStatuslineOverlaySettings({
      nodeExecutable: '/managed/node',
      forwarderScriptPath: '/happier/scripts/statusline_forwarder.cjs',
      port: 51234,
      secretFilePath: '/happier/private/statusline.secret',
      original: { command: 'bun ~/bar.ts --flag "quoted"', padding: 0 },
    });

    expect(overlay.type).toBe('command');
    expect(overlay.padding).toBe(0);
    expect(overlay.command).toContain('"/managed/node"');
    expect(overlay.command).toContain('"/happier/scripts/statusline_forwarder.cjs"');
    expect(overlay.command).toContain('51234');
    expect(overlay.command).toContain('--secret-file');
    expect(overlay.command).toContain('"/happier/private/statusline.secret"');
    expect(overlay.command).not.toContain('secret-xyz');
    const b64 = overlay.command.split(' ').at(-1)!;
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('bun ~/bar.ts --flag "quoted"');
  });

  it('omits the original argument and padding when there is no configured statusline', () => {
    const overlay = buildClaudeStatuslineOverlaySettings({
      nodeExecutable: '/managed/node',
      forwarderScriptPath: '/happier/scripts/statusline_forwarder.cjs',
      port: 51234,
      secretFilePath: '/happier/private/statusline.secret',
      original: null,
    });

    expect(overlay).toEqual({
      type: 'command',
      command: '"/managed/node" "/happier/scripts/statusline_forwarder.cjs" 51234 --secret-file "/happier/private/statusline.secret"',
    });
  });
});
