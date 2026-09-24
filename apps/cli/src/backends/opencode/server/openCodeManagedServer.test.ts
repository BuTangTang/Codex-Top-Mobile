import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';
import { buildOpenCodeV2BrokerConfigContent, startManagedOpenCodeServer } from './openCodeManagedServer';

const envKeys = ['PATH', 'HOME', 'HAPPIER_HOME_DIR', 'HAPPIER_OPENCODE_PATH'] as const;
const TEMP_DIRS = new Set<string>();
let envScope = createEnvKeyScope(envKeys);

afterEach(() => {
  envScope.restore();
  envScope = createEnvKeyScope(envKeys);
  for (const dir of TEMP_DIRS) removeTempDirSync(dir);
  TEMP_DIRS.clear();
});

describe('startManagedOpenCodeServer', () => {
  it('uses the pinned V2 plugin config key for broker materialization', () => {
    const config = JSON.parse(buildOpenCodeV2BrokerConfigContent(['openai', 'anthropic']));
    expect(config).toEqual({
      plugin: [
        expect.stringMatching(/happier-broker-openai\.js$/u),
        expect.stringMatching(/happier-broker-anthropic\.js$/u),
      ],
    });
    expect(config).not.toHaveProperty('plugins');
  });

  it('fails closed when the OpenCode CLI is unavailable', async () => {
    const root = createTempDirSync('happier-opencode-server-test-');
    TEMP_DIRS.add(root);
    process.env.HAPPIER_HOME_DIR = join(root, 'home');
    process.env.HOME = join(root, 'home');
    process.env.PATH = join(root, 'empty-path');
    delete process.env.HAPPIER_OPENCODE_PATH;

    await expect(startManagedOpenCodeServer({ port: 43111, timeoutMs: 25 })).rejects.toThrow(/system install/i);
  });
});
