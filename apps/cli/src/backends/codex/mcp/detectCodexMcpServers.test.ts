import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectCodexMcpServers } from './detectCodexMcpServers';

describe('detectCodexMcpServers', () => {
  it('reads the default CODEX_HOME from the provided env HOME when CODEX_HOME is unset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-mcp-home-'));
    const configPath = join(root, '.codex', 'config.toml');
    await mkdir(join(root, '.codex'), { recursive: true });
    await writeFile(configPath, ['[mcp_servers.alpha]', 'command = "node"', 'args = ["server.js"]', 'enabled = true'].join('\n'), 'utf8');

    const result = await detectCodexMcpServers({
      env: {
        HOME: root,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual([
      {
        provider: 'codex',
        name: 'alpha',
        transport: 'stdio',
        stdio: {
          command: 'node',
          args: ['server.js'],
        },
        envKeys: [],
        enabled: true,
        source: {
          kind: 'user',
          path: configPath,
        },
      },
    ]);
  });
});
