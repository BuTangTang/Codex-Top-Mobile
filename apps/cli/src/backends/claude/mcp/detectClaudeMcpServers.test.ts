import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectClaudeMcpServers } from './detectClaudeMcpServers';

describe('detectClaudeMcpServers', () => {
  it('reads the default Claude settings.json from the provided env HOME when no override is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-claude-mcp-home-'));
    const settingsPath = join(root, '.claude', 'settings.json');
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      mcpServers: {
        alpha: {
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'x' },
        },
      },
    }), 'utf8');

    const result = await detectClaudeMcpServers({
      directory: null,
      env: {
        HOME: root,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual([
      {
        provider: 'claude',
        name: 'alpha',
        transport: 'stdio',
        stdio: {
          command: 'node',
          args: ['server.js'],
        },
        envKeys: ['TOKEN'],
        enabled: null,
        source: {
          kind: 'user',
          path: settingsPath,
        },
      },
    ]);
  });
});
