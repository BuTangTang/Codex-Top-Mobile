import { join, resolve, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  resolveConnectedServiceGroupHomeDir,
  resolveConnectedServiceHomeDir,
} from './resolveConnectedServiceHomeDir';

describe('resolveConnectedServiceHomeDir', () => {
  it('scopes homes under the active server dir', () => {
    const dir = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'work',
      agentId: 'codex',
    });

    expect(dir).toBe(join('/', 'tmp', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex'));
  });

  it('does not allow providerScopedKey to escape the base directory', () => {
    const base = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'work',
      agentId: 'codex',
    });

    const derived = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'work',
      agentId: 'codex',
      providerScopedKey: '../evil/../../key',
    });

    expect(resolve(derived).startsWith(resolve(base))).toBe(true);
    expect(derived).not.toContain('evil');
  });

  it('uses reserved group homes that cannot collide with profile id groups on POSIX paths', () => {
    const profile = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'groups',
      agentId: 'codex',
    });
    const group = resolveConnectedServiceGroupHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      groupId: 'groups',
      agentId: 'codex',
    });

    expect(profile).toBe(join('/', 'tmp', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', 'groups', 'codex'));
    expect(group).toBe(join('/', 'tmp', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', '__groups', 'groups', 'codex'));
    expect(profile).not.toBe(group);
  });

  it('uses reserved group homes that cannot collide with profile id groups on Windows paths', () => {
    const profile = resolveConnectedServiceHomeDir({
      activeServerDir: win32.join('C:\\', 'Users', 'alice', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'groups',
      agentId: 'codex',
      pathJoin: win32.join,
    });
    const group = resolveConnectedServiceGroupHomeDir({
      activeServerDir: win32.join('C:\\', 'Users', 'alice', 'happier-server'),
      serviceId: 'openai-codex',
      groupId: 'groups',
      agentId: 'codex',
      pathJoin: win32.join,
    });

    expect(profile).toBe(win32.join('C:\\', 'Users', 'alice', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', 'groups', 'codex'));
    expect(group).toBe(win32.join('C:\\', 'Users', 'alice', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', '__groups', 'groups', 'codex'));
    expect(profile).not.toBe(group);
  });
});
