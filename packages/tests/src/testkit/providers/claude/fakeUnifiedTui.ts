import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { TERMINAL_SHIFT_TAB_SEQUENCE } from '@happier-dev/agents';

import { createTmuxTerminalControlPort, type TmuxControlCommandExecutor } from '@/integrations/tmux/control';
import type { TerminalControlPort } from '@/integrations/terminalHost/controlTypes';
import type { TmuxCommandResult } from '@/integrations/tmux/types';

/**
 * FAKE Claude Unified TUI harness (Section G).
 *
 * A controllable, stateful fake of a Claude Code interactive TUI rendered into a tmux pane. It is a
 * legitimate SYSTEM-BOUNDARY double: it implements the {@link TmuxControlCommandExecutor} boundary
 * (the `tmux send-keys` / `capture-pane` process surface) so the REAL Lane C terminal-control port and
 * the REAL Lane D runtime-control controller run unmodified against it. It never imports or mocks any
 * controller / parser / bridge internals.
 *
 * Capabilities (Section G checklist):
 * - renders an idle prompt/status line;
 * - accepts `/model` and `/effort` slash commands typed literally + submitted with Enter;
 * - cycles permission/plan modes when the raw ShiftTab sequence (`[Z`) is sent;
 * - shows a `Switch model?` confirmation dialog (history-cache gotcha) that must be answered;
 * - shows a queued-message banner when a slash command is typed during generation;
 * - exposes `/permissions` as an editor screen (recognized + vetoed as a mode setter);
 * - emits provider lifecycle metadata via {@link FakeUnifiedTui.emitUserPromptSubmit};
 * - simulates heavy-resume non-interactive screens, host exit, and injected-but-not-accepted prompts;
 * - exposes NO OpenTelemetry / statusline evidence by default (verification stays on TUI + hooks).
 *
 * The harness optionally simulates Claude persisting a default model into the active config root so the
 * settings-isolation guard (Lane D B12) snapshot/restore can be verified byte-identical in an E2E.
 */

export type FakeTuiModeMarker = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';

export type FakeTuiScreenKind = 'interactive' | 'heavyResumeNonInteractive' | 'empty';

export type FakeTuiDialog = 'none' | 'switchModel' | 'permissionPrompt' | 'trustFolder';

const MODE_MARKER_LINE: Readonly<Record<FakeTuiModeMarker, string | null>> = {
  // `default` is detected by ABSENCE of any marker (probe P-E) — never render a marker for it.
  default: null,
  acceptEdits: '⏵⏵ accept edits on (shift+tab to cycle)',
  plan: '⏸ plan mode on (shift+tab to cycle)',
  auto: '⏵⏵ auto mode on (shift+tab to cycle)',
  bypassPermissions: '⏵⏵ bypass permissions on (shift+tab to cycle)',
};

export type FakeUnifiedTuiOptions = Readonly<{
  /** tmux target the control port addresses (any string; the fake ignores routing). */
  target?: string;
  /** Initial visible mode marker. Default `default`. */
  initialMode?: FakeTuiModeMarker;
  /** Initial visible model / effort. Default null (none shown). */
  initialModel?: string | null;
  initialEffort?: string | null;
  /** ShiftTab cycle order. `auto`/`bypass` are model/account-gated and can be omitted (probe P-E). */
  cycleOrder?: readonly FakeTuiModeMarker[];
  /** When true, `/model` opens a `Switch model?` confirmation dialog (history cache present, probe P-C). */
  requireSwitchModelDialog?: boolean;
  /** When true, applying `/model` does NOT render a confirmation → controller verification fails. */
  failModelVerification?: boolean;
  /** When true, applying `/effort` does NOT render a confirmation → controller verification fails. */
  failEffortVerification?: boolean;
  /**
   * Config root the harness writes a persisted `model` default into when `/model` applies (probe P-B).
   * Provide the SAME dir the settings guard snapshots to verify byte-identical restore in an E2E.
   */
  persistModelToConfigDir?: string;
  /** Map a requested model alias to the display name Claude echoes in its confirmation. */
  modelDisplayName?: (requested: string) => string;
}>;

export type FakeTuiCommandRecord =
  | Readonly<{ kind: 'literal'; text: string }>
  | Readonly<{ kind: 'shiftTab' }>
  | Readonly<{ kind: 'named'; key: string }>
  | Readonly<{ kind: 'capture' }>;

export interface FakeUnifiedTui {
  /** The tmux executor boundary; pass to `createTmuxTerminalControlPort`. */
  readonly executor: TmuxControlCommandExecutor;
  /** A REAL Lane C tmux control port already bound to {@link executor}. */
  readonly port: TerminalControlPort;
  /** Ordered log of every boundary operation the controller performed. */
  readonly commandLog: readonly FakeTuiCommandRecord[];
  /** Literal text payloads the controller sent (excludes raw ShiftTab). */
  readonly literalSends: readonly string[];
  render(): string;
  beginGeneration(): void;
  endGeneration(): void;
  showQueuedBanner(): void;
  openPermissionPrompt(): void;
  openPermissionEditor(): void;
  setScreenKind(kind: FakeTuiScreenKind): void;
  killHost(): void;
  reviveHost(): void;
  /** Simulate Claude dropping a submitted prompt (bytes sent, provider never accepted it). */
  setInjectedButNotAccepted(value: boolean): void;
  getMode(): FakeTuiModeMarker;
  getVisibleModel(): string | null;
  getVisibleEffort(): string | null;
  /** True once a prompt was submitted and accepted (host alive, not in injected-but-not-accepted mode). */
  promptWasAccepted(): boolean;
  /** Provider lifecycle metadata the runner would feed `reconcileAfterProviderPromptSubmit`. */
  emitUserPromptSubmit(): Readonly<{ model?: string; permissionMode: FakeTuiModeMarker; reasoningEffort?: string }>;
}

function okResult(command: readonly string[], stdout: string): TmuxCommandResult {
  return { returncode: 0, stdout, stderr: '', command: [...command] };
}

function hostDeadResult(command: readonly string[]): TmuxCommandResult {
  return { returncode: 1, stdout: '', stderr: "can't find pane: %1", command: [...command] };
}

export function createFakeUnifiedTui(options: FakeUnifiedTuiOptions = {}): FakeUnifiedTui {
  const target = options.target ?? 'happier:0.0';
  const cycleOrder = options.cycleOrder ?? ['default', 'acceptEdits', 'plan', 'auto'];
  const displayName = options.modelDisplayName ?? ((requested) => requested);

  let mode: FakeTuiModeMarker = options.initialMode ?? 'default';
  let visibleModel: string | null = options.initialModel ?? null;
  let visibleEffort: string | null = options.initialEffort ?? null;
  let composer = '';
  let generating = false;
  let queuedBanner = false;
  let dialog: FakeTuiDialog = 'none';
  let permissionEditorOpen = false;
  let screenKind: FakeTuiScreenKind = 'interactive';
  let hostDead = false;
  let promptAccepted = false;
  let injectedButNotAccepted = false;
  let pendingModel: string | null = null;
  const confirmations: string[] = [];

  const commandLog: FakeTuiCommandRecord[] = [];
  const literalSends: string[] = [];

  function persistModel(model: string): void {
    if (!options.persistModelToConfigDir) return;
    const dir = options.persistModelToConfigDir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, 'settings.json');
    let current: Record<string, unknown> = {};
    if (existsSync(file)) {
      try {
        current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      } catch {
        current = {};
      }
    }
    current.model = model;
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  }

  function applyModel(requested: string): void {
    if (options.failModelVerification) return;
    const shown = displayName(requested);
    visibleModel = shown;
    confirmations.push(`Set model to ${shown} and saved as your default for new sessions`);
    persistModel(requested);
  }

  function applyEffort(requested: string): void {
    if (options.failEffortVerification) return;
    visibleEffort = requested.toLowerCase();
    confirmations.push(`Set effort to ${requested.toLowerCase()}`);
  }

  function cycleMode(): void {
    const idx = cycleOrder.indexOf(mode);
    const next = cycleOrder[(idx < 0 ? 0 : idx + 1) % cycleOrder.length];
    mode = next ?? 'default';
  }

  function handleEnter(): void {
    const trimmed = composer.trim();
    if (dialog === 'switchModel') {
      if (trimmed === '1' && pendingModel !== null) {
        applyModel(pendingModel);
      }
      pendingModel = null;
      dialog = 'none';
      composer = '';
      return;
    }
    if (trimmed.startsWith('/model ')) {
      const requested = trimmed.slice('/model '.length).trim();
      composer = '';
      if (options.requireSwitchModelDialog) {
        pendingModel = requested;
        dialog = 'switchModel';
        return;
      }
      applyModel(requested);
      return;
    }
    if (trimmed.startsWith('/effort ')) {
      const requested = trimmed.slice('/effort '.length).trim();
      composer = '';
      applyEffort(requested);
      return;
    }
    if (trimmed === '/permissions') {
      composer = '';
      permissionEditorOpen = true;
      return;
    }
    // Anything else is a user prompt submission.
    if (trimmed.length > 0) {
      if (!injectedButNotAccepted) promptAccepted = true;
      composer = '';
    }
  }

  function handleNamedKey(key: string): void {
    if (key === 'Enter') {
      handleEnter();
      return;
    }
    if (key === 'Escape') {
      composer = '';
      if (dialog === 'switchModel' || dialog === 'permissionPrompt' || dialog === 'trustFolder') {
        dialog = 'none';
        pendingModel = null;
      }
      permissionEditorOpen = false;
      return;
    }
    // Tab / C-c / BSpace are accepted no-ops for the control flows under test.
  }

  function render(): string {
    if (screenKind === 'empty') return '';
    if (screenKind === 'heavyResumeNonInteractive') {
      // Stable but NON-interactive: a resume/transcript screen with no composer, no work prompt, no
      // mode marker. Readiness/controls must NOT treat this as a safe interactive window.
      return [
        'Resuming session from on-disk history…',
        'user: earlier user turn',
        'assistant: earlier assistant turn',
        '(loading 3,128 lines of prior transcript)',
      ].join('\n');
    }

    const lines: string[] = [];
    lines.push('Claude Code');
    for (const confirmation of confirmations.slice(-4)) lines.push(confirmation);

    if (dialog === 'switchModel') {
      lines.push('Reading model configuration from cache…');
      lines.push('Switch model?');
      lines.push('  1. Yes, switch');
      lines.push('  2. No, go back');
    } else if (dialog === 'permissionPrompt') {
      lines.push('Bash(rm -rf build)');
      lines.push('Do you want to proceed?');
      lines.push('  1. Yes');
      lines.push('  2. Yes, and don’t ask again');
      lines.push('  3. No, tell Claude what to do differently');
    } else if (dialog === 'trustFolder') {
      lines.push('Do you trust the files in this folder?');
    }

    if (permissionEditorOpen) {
      lines.push('Permission rules');
      lines.push('  Allow  Bash(npm run test:*)');
      lines.push('  Deny   Read(./.env)');
    }

    const markerLine = MODE_MARKER_LINE[mode];
    if (markerLine) lines.push(markerLine);

    if (generating || queuedBanner) {
      lines.push('· Generating… (esc to interrupt)');
    }
    if (queuedBanner) {
      lines.push('Press up to edit queued messages');
    }

    if (dialog === 'none' && !permissionEditorOpen && !generating && !queuedBanner && composer.length === 0) {
      lines.push('What would you like to work on?');
    }
    lines.push(`> ${composer}`);
    return lines.join('\n');
  }

  const executor: TmuxControlCommandExecutor = async (args) => {
    const argv = [...args];
    if (hostDead) {
      return hostDeadResult(argv);
    }
    if (argv[0] === 'capture-pane') {
      commandLog.push({ kind: 'capture' });
      return okResult(argv, render());
    }
    if (argv[0] === 'send-keys') {
      const literalIdx = argv.indexOf('--');
      if (argv.includes('-l') && literalIdx >= 0) {
        const payload = argv.slice(literalIdx + 1).join('');
        if (payload === TERMINAL_SHIFT_TAB_SEQUENCE) {
          commandLog.push({ kind: 'shiftTab' });
          cycleMode();
        } else {
          commandLog.push({ kind: 'literal', text: payload });
          literalSends.push(payload);
          composer += payload;
        }
        return okResult(argv, '');
      }
      const key = argv[argv.length - 1];
      commandLog.push({ kind: 'named', key });
      handleNamedKey(key);
      return okResult(argv, '');
    }
    // Unknown command: succeed as a no-op so unrelated host probes do not fail the control flow.
    return okResult(argv, '');
  };

  const port = createTmuxTerminalControlPort({ executor, target });

  return {
    executor,
    port,
    commandLog,
    literalSends,
    render,
    beginGeneration() {
      generating = true;
    },
    endGeneration() {
      generating = false;
      queuedBanner = false;
    },
    showQueuedBanner() {
      generating = true;
      queuedBanner = true;
    },
    openPermissionPrompt() {
      dialog = 'permissionPrompt';
    },
    openPermissionEditor() {
      permissionEditorOpen = true;
    },
    setScreenKind(kind) {
      screenKind = kind;
    },
    killHost() {
      hostDead = true;
    },
    reviveHost() {
      hostDead = false;
    },
    setInjectedButNotAccepted(value) {
      injectedButNotAccepted = value;
    },
    getMode() {
      return mode;
    },
    getVisibleModel() {
      return visibleModel;
    },
    getVisibleEffort() {
      return visibleEffort;
    },
    promptWasAccepted() {
      return promptAccepted;
    },
    emitUserPromptSubmit() {
      return {
        ...(visibleModel !== null ? { model: visibleModel } : {}),
        permissionMode: mode,
        ...(visibleEffort !== null ? { reasoningEffort: visibleEffort } : {}),
      };
    },
  };
}
