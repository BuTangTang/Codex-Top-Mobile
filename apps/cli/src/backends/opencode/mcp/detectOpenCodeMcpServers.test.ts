import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectOpenCodeMcpServers } from './detectOpenCodeMcpServers';

describe('detectOpenCodeMcpServers', () => {
  it('reads the default XDG config home from the provided env HOME when XDG_CONFIG_HOME is unset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-opencode-mcp-home-'));
    const configPath = join(root, '.config', 'opencode', 'opencode.json');
    await mkdir(join(root, '.config', 'opencode'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        alpha: {
          command: 'node',
          args: ['server.js'],
        },
      },
    }), 'utf8');

    const result = await detectOpenCodeMcpServers({
      directory: null,
      env: {
        HOME: root,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual([
      {
        provider: 'opencode',
        name: 'alpha',
        transport: 'stdio',
        stdio: {
          command: 'node',
          args: ['server.js'],
        },
        envKeys: [],
        enabled: null,
        source: {
          kind: 'user',
          path: configPath,
        },
      },
    ]);
  });
});
