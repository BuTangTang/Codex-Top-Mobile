/**
 * Provider E2E (G8 / P7.1): regression-test the REAL Claude screen-state parser against probe SCREEN
 * fixtures stored by Claude version + host kind, so parser changes can be validated WITHOUT rerunning
 * real (paid, interactive) probes. New Claude versions add a sibling version directory of fixtures
 * rather than mutating these captures in place.
 *
 * Fixtures live at `src/testkit/providers/claude/screenFixtures/<claude-version>/<hostKind>/<scenario>.txt`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isSafeWindowForModeCycle,
  isSafeWindowForSlashControl,
  parseClaudeScreenState,
  type ClaudeScreenState,
} from '@/backends/claude/unifiedTerminal/tuiControls';

const FIXTURE_ROOT = join(__dirname, '../../src/testkit/providers/claude/screenFixtures');
const HOST_KIND = 'tmux';

type ScenarioExpectation = Readonly<{
  expect: Partial<ClaudeScreenState>;
  /** Whether `/model` & `/effort` may be typed and ShiftTab may cycle on this screen. */
  safeForSlashControl: boolean;
  safeForModeCycle: boolean;
}>;

// Each fixture file MUST have an entry here; the test fails if a fixture is undocumented.
const SCENARIOS_2_1_170: Readonly<Record<string, ScenarioExpectation>> = {
  idle: {
    expect: { inputBoxInteractive: true, generating: false, modeMarker: 'default' },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  acceptEdits: {
    expect: { inputBoxInteractive: true, modeMarker: 'acceptEdits' },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  planMode: {
    expect: { inputBoxInteractive: true, modeMarker: 'plan' },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  autoMode: {
    expect: { inputBoxInteractive: true, modeMarker: 'auto' },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  switchModelDialog: {
    expect: { switchModelDialogVisible: true, inputBoxInteractive: false },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
  queuedDuringGeneration: {
    expect: { generating: true, queuedMessageBannerVisible: true, inputBoxInteractive: false },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
  permissionPrompt: {
    expect: { permissionPromptVisible: true, inputBoxInteractive: false },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
  permissionEditor: {
    expect: { permissionEditorOpen: true, inputBoxInteractive: false },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
  trustFolder: {
    expect: { trustFolderPromptVisible: true, inputBoxInteractive: false },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
  modelConfirmation: {
    expect: { visibleModel: 'Sonnet 4.6', inputBoxInteractive: true },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  effortConfirmation: {
    expect: { visibleEffort: 'high', inputBoxInteractive: true },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  heavyResumeNonInteractive: {
    expect: { inputBoxInteractive: false, generating: false, modeMarker: 'default' },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
};

// Live probe captures 2026-06-11 (probes/lane-n, incident cmq8y3nlx L6): the `Change effort level?`
// confirmation dialog `/effort <level>` opens on a conversation cached at a different effort, plus
// the 2.1.173 `Switch model?` wording ("Yes, switch to <model>").
const SCENARIOS_2_1_173: Readonly<Record<string, ScenarioExpectation>> = {
  effortChangeDialog: {
    expect: {
      effortChangeDialogVisible: true,
      effortChangeDialogTarget: 'high',
      inputBoxInteractive: false,
      generating: false,
    },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
  effortKeptAfterDecline: {
    expect: {
      effortChangeDialogVisible: false,
      latestEffortConfirmation: { kind: 'kept', level: 'low' },
      // Stale "Set effort level to …" rows linger above; the latest one wins.
      visibleEffort: 'low',
      inputBoxInteractive: true,
    },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  effortSetAfterDialogConfirm: {
    expect: {
      effortChangeDialogVisible: false,
      latestEffortConfirmation: { kind: 'set', level: 'high' },
      visibleEffort: 'high',
      inputBoxInteractive: true,
    },
    safeForSlashControl: true,
    safeForModeCycle: true,
  },
  switchModelDialog: {
    expect: { switchModelDialogVisible: true, inputBoxInteractive: false },
    safeForSlashControl: false,
    safeForModeCycle: false,
  },
};

const MANIFESTS: Readonly<Record<string, Readonly<Record<string, ScenarioExpectation>>>> = {
  'claude-2.1.170': SCENARIOS_2_1_170,
  'claude-2.1.173': SCENARIOS_2_1_173,
};

for (const [claudeVersion, scenarios] of Object.entries(MANIFESTS)) {
  describe(`Claude screen-state parser regression — ${claudeVersion}/${HOST_KIND} (G8)`, () => {
    const fixtureDir = join(FIXTURE_ROOT, claudeVersion, HOST_KIND);
    const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.txt'));

    it('has at least one fixture and every fixture is documented in the manifest', () => {
      expect(fixtureFiles.length).toBeGreaterThan(0);
      for (const file of fixtureFiles) {
        const scenario = file.replace(/\.txt$/, '');
        expect(scenarios[scenario], `undocumented fixture: ${file}`).toBeDefined();
      }
    });

    for (const [scenario, expectation] of Object.entries(scenarios)) {
      it(`parses ${scenario} with the expected flags`, () => {
        const raw = readFileSync(join(fixtureDir, `${scenario}.txt`), 'utf8');
        const state = parseClaudeScreenState(raw);

        expect(state).toMatchObject(expectation.expect);
        expect(isSafeWindowForSlashControl(state)).toBe(expectation.safeForSlashControl);
        expect(isSafeWindowForModeCycle(state)).toBe(expectation.safeForModeCycle);
      });
    }
  });
}
