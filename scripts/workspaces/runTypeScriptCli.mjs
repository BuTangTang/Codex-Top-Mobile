#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { resolveTypeScriptCommandInvocation } from './typescriptCommand.mjs';

const invocation = resolveTypeScriptCommandInvocation({
  cwd: process.cwd(),
  args: process.argv.slice(2),
});

const result = spawnSync(invocation.command, invocation.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
