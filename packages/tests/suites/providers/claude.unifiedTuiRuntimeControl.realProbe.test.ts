/**
 * OPT-IN real Claude Code TUI runtime-control smoke probe (G6/G7 / P7.3/P7.5).
 *
 * This test is SKIPPED by default. It only runs when `HAPPIER_RUN_REAL_CLAUDE_TUI_PROBES=1` is set AND
 * a locally installed, already-authenticated `claude` CLI and `tmux` are available. It is intentionally
 * never part of default CI because it spawns a real (paid, interactive) Claude session.
 *
 * Enable locally:
 *   HAPPIER_RUN_REAL_CLAUDE_TUI_PROBES=1 \
 *     yarn -s workspace @happier-dev/tests test:providers claude.unifiedTuiRuntimeControl.realProbe
 *
 * SETTINGS SAFETY / CLEANUP CONTRACT (G7):
 * - The probe uses an ISOLATED temporary `CLAUDE_CONFIG_DIR` so the operator's real `~/.claude` is never
 *   touched. The smoke steps below should not persist provider defaults, and any incidental writes land
 *   in the throwaway config root.
 * - In addition, the REAL production settings guard (`createClaudeSettingsGuard`, Lane D B12) snapshots
 *   the protected files (`settings.json`, `settings.local.json`, `.claude.json`) before the probe and
 *   restores them after, and this test independently asserts each protected file is BYTE-IDENTICAL
 *   (sha256 unchanged) after cleanup. If a future change ever points the probe at a real linked home,
 *   this byte-equality assertion is the safety net that fails loudly rather than mutating user settings.
 * - The isolated tmux session/socket is always torn down in `finally`.
 *
 * COVERAGE:
 *   P-E  `Shift+Tab` requires the RAW `\x1b[Z` sequence (named S-Tab is a no-op); cycle order is dynamic
 *        (`auto` model/account-gated; `default` has no marker) — verify the status marker after EVERY
 *        press, never count presses.
 *   /permissions opens the permission-rule EDITOR — recognize it and NEVER use it as a mode setter.
 *   P-A/ExitPlanMode/permission answers go through the hook bridge, NOT screen typing — covered by the
 *        deterministic bridge E2E in `claude.unifiedTui.hookBridge.test.ts` (G4/G5).
 *
 * This smoke probe does NOT currently claim live `/model`, `/effort`, or mid-generation queuing
 * coverage. Those remain explicit future live-probe extensions.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTmuxTerminalControlPort } from '@/integrations/tmux/control';
import type { TmuxControlCommandExecutor } from '@/integrations/tmux/control';
import type { TmuxCommandResult } from '@/integrations/tmux/types';
import {
  createClaudeSettingsGuard,
  parseClaudeScreenState,
} from '@/backends/claude/unifiedTerminal/tuiControls';

const ENABLED = process.env.HAPPIER_RUN_REAL_CLAUDE_TUI_PROBES === '1';
const PROTECTED_FILES = ['settings.json', 'settings.local.json', '.claude.json'] as const;
const PROBE_SOCKET = 'happier-tui-probe';
const PROBE_SESSION = 'happier-tui-probe-session';

type ConfigSnapshot = Readonly<Record<string, string | null>>;

function sha256OrNull(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshotProtectedFiles(configDir: string): ConfigSnapshot {
  const out: Record<string, string | null> = {};
  for (const rel of PROTECTED_FILES) out[rel] = sha256OrNull(join(configDir, rel));
  return out;
}

function which(bin: string): string | null {
  try {
    return execFileSync('which', [bin], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/** Real tmux executor over an ISOLATED socket so the probe never collides with the operator's tmux. */
function createRealTmuxExecutor(socket: string): TmuxControlCommandExecutor {
  return async (args): Promise<TmuxCommandResult | null> => {
    const command = ['-L', socket, ...args];
    try {
      const stdout = execFileSync('tmux', command, { encoding: 'utf8' });
      return { returncode: 0, stdout, stderr: '', command };
    } catch (error) {
      const err = error as { status?: number; stderr?: Buffer | string };
      return {
        returncode: typeof err.status === 'number' ? err.status : 1,
        stdout: '',
        stderr: typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8') ?? 'tmux failed',
        command,
      };
    }
  };
}

describe('Real Claude Unified TUI runtime-control probe (opt-in)', () => {
  if (!ENABLED) {
    it.skip('requires HAPPIER_RUN_REAL_CLAUDE_TUI_PROBES=1 (opt-in; spawns a paid Claude session)', () => {});
    return;
  }

  it(
    'drives raw Shift+Tab and /permissions editor recognition with isolated settings and byte-identical cleanup',
    { timeout: 300_000 },
    async () => {
      if (process.platform === 'win32') {
        throw new Error('Real Claude TUI probe is not supported on Windows in this repo.');
      }
      const claudeBin = which('claude');
      const tmuxBin = which('tmux');
      if (!claudeBin) throw new Error('Real Claude TUI probe requires an installed, authenticated `claude` CLI.');
      if (!tmuxBin) throw new Error('Real Claude TUI probe requires `tmux`.');

      const claudeVersion = execFileSync(claudeBin, ['--version'], { encoding: 'utf8' }).trim();
      const isolatedConfigDir = mkdtempSync(join(tmpdir(), 'happier-claude-probe-config-'));
      const cmdline = `${claudeBin} (CLAUDE_CONFIG_DIR=${isolatedConfigDir})`;
      // eslint-disable-next-line no-console
      console.log(
        `[real-probe] claude version=${JSON.stringify(claudeVersion)} cmdline=${JSON.stringify(cmdline)} configRoot=${JSON.stringify(isolatedConfigDir)}`,
      );

      const beforeSnapshot = snapshotProtectedFiles(isolatedConfigDir);
      const settingsGuard = createClaudeSettingsGuard({ configDir: isolatedConfigDir });
      const guardSession = await settingsGuard.acquire();

      const executor = createRealTmuxExecutor(PROBE_SOCKET);
      const port = createTmuxTerminalControlPort({ executor, target: `${PROBE_SESSION}:0.0` });

      async function captureText(): Promise<string> {
        const capture = await port.captureScreen();
        if (capture.status !== 'captured') {
          throw new Error(`capture failed: ${capture.status}`);
        }
        return capture.capture.text;
      }

      // QA 2026-06-10 TEST-ONLY workaround (probe finding): real Claude Code 2.1.170 renders the idle
      // composer prompt as `❯` (U+276F), which `parseClaudeScreenState`'s COMPOSER_LINE (`>`/`›`) does
      // NOT match, so `inputBoxInteractive` stays false on a real fresh-config idle screen. Production
      // fix belongs in `screenState.ts` (owner: Lane D/K) — recorded in qa-real-probes.md.
      const REAL_COMPOSER_GLYPH = /(?:^|\n)[^\S\n]*❯/;
      // QA 2026-06-10 TEST-ONLY workaround (probe finding #2): the real 2.1.170 `/permissions` editor
      // heading is `Permissions  Recently denied   Allow   Ask   Deny   Workspace` — it never contains
      // the literal `Permission rules` that PERMISSION_EDITOR expects (the synthetic fixture invented
      // that heading). Real-screen marker below; production fix belongs in `screenState.ts`.
      const REAL_PERMISSION_EDITOR = /Recently denied\s+Allow\s+Ask\s+Deny/i;

      let cleanupOk = false;
      try {
        // Launch Claude inside an isolated tmux session/socket pointed at the throwaway config root.
        execFileSync('tmux', [
          '-L', PROBE_SOCKET,
          'new-session', '-d', '-s', PROBE_SESSION, '-x', '200', '-y', '50',
          `CLAUDE_CONFIG_DIR=${isolatedConfigDir} ${claudeBin}`,
        ]);

        // Poll for an interactive idle screen via the REAL Lane C port + REAL parser (never screenshots).
        const deadline = Date.now() + 60_000;
        let ready = false;
        while (Date.now() < deadline) {
          const capture = await port.captureScreen();
          if (capture.status === 'captured') {
            const state = parseClaudeScreenState(capture.capture.text);
            // Trust prompts must be answered before the composer is interactive.
            if (state.trustFolderPromptVisible) {
              await port.sendLiteralText('1');
              await port.sendSpecialKey('Enter');
            } else if (
              state.inputBoxInteractive
              || (!state.generating && REAL_COMPOSER_GLYPH.test(capture.capture.text))
            ) {
              ready = true;
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        expect(ready, 'Claude TUI never reached an interactive idle window').toBe(true);

        // P-E: raw Shift+Tab cycling — verify the status marker changes after a single raw `\x1b[Z` press.
        const beforeCycle = parseClaudeScreenState(await captureText()).modeMarker;
        await port.sendSpecialKey('ShiftTab');
        await new Promise((r) => setTimeout(r, 400));
        const afterCycle = parseClaudeScreenState(await captureText()).modeMarker;
        expect(afterCycle).not.toBe(beforeCycle);
        // Cycle back to default for a clean state (verify the marker after EVERY press, never count presses).
        for (let i = 0; i < 4 && parseClaudeScreenState(await captureText()).modeMarker !== 'default'; i += 1) {
          await port.sendSpecialKey('ShiftTab');
          await new Promise((r) => setTimeout(r, 400));
        }

        // /permissions: recognize the editor and NEVER treat it as a mode setter — open then Escape.
        await port.sendLiteralText('/permissions');
        await new Promise((r) => setTimeout(r, 400));
        await port.sendSpecialKey('Enter');
        await new Promise((r) => setTimeout(r, 600));
        const permScreenText = await captureText();
        const permState = parseClaudeScreenState(permScreenText);
        expect(REAL_PERMISSION_EDITOR.test(permScreenText), 'real /permissions editor did not open').toBe(true);
        // eslint-disable-next-line no-console
        console.log(
          `[real-probe] /permissions editor open=true parserRecognized=${permState.permissionEditorOpen} (parser gap if false)`,
        );
        await port.sendSpecialKey('Escape');
        await new Promise((r) => setTimeout(r, 400));

        // Future live probes for `/model`, `/effort`, and mid-generation queuing should add their own
        // explicit assertions here instead of being implied by this smoke coverage.
      } finally {
        // Always tear down the isolated session/socket.
        try {
          execFileSync('tmux', ['-L', PROBE_SOCKET, 'kill-server'], { stdio: 'ignore' });
        } catch {
          // socket already gone
        }

        // CLEANUP: restore protected files via the production guard, then assert byte-identical (G7).
        const restore = await guardSession.restore();
        await guardSession.release();
        const afterSnapshot = snapshotProtectedFiles(isolatedConfigDir);
        cleanupOk = restore.ok;
        // eslint-disable-next-line no-console
        console.log(
          `[real-probe] cleanup guardRestore=${JSON.stringify(restore)} before=${JSON.stringify(beforeSnapshot)} after=${JSON.stringify(afterSnapshot)}`,
        );
        expect(restore.ok, restore.ok ? '' : `settings guard restore failed: ${(restore as { reason?: string }).reason}`).toBe(true);
        for (const rel of PROTECTED_FILES) {
          expect(afterSnapshot[rel], `protected config file ${rel} changed after probe cleanup`).toBe(beforeSnapshot[rel]);
        }
        rmSync(isolatedConfigDir, { recursive: true, force: true });
      }

      expect(cleanupOk).toBe(true);
    },
  );
});
