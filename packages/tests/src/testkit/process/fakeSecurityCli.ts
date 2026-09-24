import { chmod, writeFile } from 'node:fs/promises';

import type { TempPathBin } from '../fs/tempPathBin';

export type InstalledFakeSecurityCli = Readonly<{
  commandPath: string;
  storePath: string;
}>;

function buildFakeSecurityCliScript(storePath: string): string {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    `const storePath = ${JSON.stringify(storePath)};`,
    'function readStore() {',
    "  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch { return {}; }",
    '}',
    'function writeStore(store) {',
    "  fs.writeFileSync(storePath, JSON.stringify(store), 'utf8');",
    '}',
    'function getFlagValue(flag) {',
    '  const index = process.argv.indexOf(flag);',
    '  if (index < 0 || index + 1 >= process.argv.length) return null;',
    '  return process.argv[index + 1] ?? null;',
    '}',
    'function firstNonEmptyLine(raw) {',
    "  return raw.split(/\\r?\\n/).find((line) => line.trim().length > 0) ?? '';",
    '}',
    'const command = process.argv[2] ?? "";',
    'const service = getFlagValue("-s");',
    'const account = getFlagValue("-a") ?? "_default";',
    'const store = readStore();',
    'if (!service) {',
    '  process.stderr.write("fake-security: missing service\\n");',
    '  process.exit(64);',
    '}',
    'if (command === "add-generic-password") {',
    "  const secret = firstNonEmptyLine(fs.readFileSync(0, 'utf8'));",
    '  if (secret.length === 0) {',
    '    process.stderr.write("fake-security: missing secret\\n");',
    '    process.exit(65);',
    '  }',
    '  store[service] = { ...(store[service] ?? {}), [account]: secret };',
    '  writeStore(store);',
    '  process.exit(0);',
    '}',
    'if (command === "find-generic-password") {',
    '  const byService = store[service];',
    '  const secret = byService && typeof byService === "object" ? Object.values(byService)[0] : null;',
    '  if (typeof secret !== "string" || secret.length === 0) {',
    '    process.stderr.write("fake-security: item not found\\n");',
    '    process.exit(44);',
    '  }',
    '  process.stdout.write(`${secret}\\n`);',
    '  process.exit(0);',
    '}',
    'if (command === "delete-generic-password") {',
    '  if (!Object.prototype.hasOwnProperty.call(store, service)) {',
    '    process.stderr.write("fake-security: item not found\\n");',
    '    process.exit(44);',
    '  }',
    '  delete store[service];',
    '  writeStore(store);',
    '  process.exit(0);',
    '}',
    'process.stderr.write(`fake-security: unsupported command ${command}\\n`);',
    'process.exit(64);',
    '',
  ].join('\n');
}

export async function installFakeSecurityCli(tempPathBin: TempPathBin): Promise<InstalledFakeSecurityCli> {
  const baseCommandPath = tempPathBin.resolveCommandPath('security');
  const storePath = tempPathBin.resolveCommandPath('security-store.json');

  if (process.platform === 'win32') {
    const scriptPath = tempPathBin.resolveCommandPath('security.cjs');
    const commandPath = `${baseCommandPath}.cmd`;
    await writeFile(scriptPath, buildFakeSecurityCliScript(storePath), 'utf8');
    await writeFile(commandPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
    return { commandPath, storePath };
  }

  await writeFile(baseCommandPath, buildFakeSecurityCliScript(storePath), 'utf8');
  await chmod(baseCommandPath, 0o755);
  return { commandPath: baseCommandPath, storePath };
}
