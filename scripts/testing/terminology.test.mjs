/**
 * Terminology guard.
 *
 * Fails CI if forbidden user-facing strings appear in the doctor-repair render
 * path. Catches regressions in copy: we don't want to drift back to
 * "Default background service" (as a rendered name), "Daemon:" as a section
 * header, or internal vocab like "aligned"/"reconcile"/"convergence" in text
 * users see.
 *
 * Scope: files that emit user-facing strings for the repair command family.
 * Production source only (tests can still reference legacy terms for fixtures).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCAN_ROOTS = [
  'apps/cli/src/cli/commands/serviceRepair',
  'apps/cli/src/diagnostics/doctorRepair',
  'apps/cli/src/ui/format',
];

const FORBIDDEN = [
  // Drifted or internal vocabulary that must not appear in user-visible strings.
  // Each entry is { pattern, hint } — pattern is a RegExp matched against file contents,
  // hint is a human message.
  { pattern: /chalk\.bold\(['"`]Daemon:['"`]\)/, hint: '"Daemon:" is not a section header — use "Currently running" instead.' },
  { pattern: /['"`](?:aligned|alignment)['"`]/, hint: '"aligned"/"alignment" is not our vocabulary. Say "looks good" / "matches" instead.' },
  { pattern: /['"`]reconcile['"`]/i, hint: '"reconcile" is internal. Use plain verbs in user text.' },
  { pattern: /['"`]convergence['"`]/i, hint: '"convergence" is internal. Use plain verbs in user text.' },
];

/**
 * "Default background service" is the legacy name that may still appear in
 * existing systemd/launchd units on user machines. The *render path* may show
 * it faithfully in that case (we don't lie about the installed label), so we
 * exclude this file set from that specific check. Other forbidden strings
 * still apply.
 */
const LEGACY_NAME_IN_RENDERERS_OK = new Set(['renderAutomaticStartup.ts']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

test('doctor-repair render path has no forbidden user-facing vocabulary', () => {
  const offenders = [];
  for (const rel of SCAN_ROOTS) {
    const root = join(ROOT, rel);
    for (const file of walk(root)) {
      const text = readFileSync(file, 'utf8');
      for (const { pattern, hint } of FORBIDDEN) {
        if (pattern.test(text)) {
          offenders.push({ file, hint });
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `Forbidden terminology found:\n${offenders.map((o) => `  ${o.file}: ${o.hint}`).join('\n')}`);
});

test('canonical section headers live in _copy.ts', () => {
  const copyFile = join(ROOT, 'apps/cli/src/cli/commands/serviceRepair/prompts/_copy.ts');
  const text = readFileSync(copyFile, 'utf8');
  assert.match(text, /SECTION_CURRENT_CLI = 'Current CLI'/);
  assert.match(text, /SECTION_BACKGROUND_SERVICES = 'Background services'/);
  assert.match(text, /SECTION_LOCAL_RELAYS = 'Local relays'/);
});

void LEGACY_NAME_IN_RENDERERS_OK; // reserved for future per-file exceptions
