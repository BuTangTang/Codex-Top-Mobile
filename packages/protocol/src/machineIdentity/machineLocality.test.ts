import { describe, expect, it } from 'vitest';

import {
  isSameMachineLocality,
  resolveMachineLocality,
} from './machineLocality.js';

describe('machine locality', () => {
  it('integrates protocol host normalization with home-directory identity comparison', () => {
    expect(isSameMachineLocality({
      sessionHost: 'LEEROY-MBP.local',
      sessionHomeDir: '~/work/',
      currentHost: 'leeroy-mbp',
      currentHomeDir: '/Users/leeroy/work',
      homeDir: '/Users/leeroy',
      platform: 'posix',
    })).toBe(true);
  });

  it('distinguishes host and home mismatches', () => {
    expect(resolveMachineLocality({
      sessionHost: 'mbp.local',
      sessionHomeDir: '/Users/alice',
      currentHost: 'imac',
      currentHomeDir: '/Users/alice',
    })).toEqual({
      sameHost: false,
      sameHomeDir: true,
      local: false,
    });

    expect(resolveMachineLocality({
      sessionHost: 'mbp.local',
      sessionHomeDir: '/Users/alice',
      currentHost: 'mbp',
      currentHomeDir: '/Users/alice2',
    })).toEqual({
      sameHost: true,
      sameHomeDir: false,
      local: false,
    });
  });

  it('compares Windows homes case-insensitively while still rejecting sibling prefixes', () => {
    expect(isSameMachineLocality({
      sessionHost: 'WINBOX.local',
      sessionHomeDir: 'C:/Users/Alice',
      currentHost: 'winbox',
      currentHomeDir: 'c:\\users\\alice\\',
      platform: 'win32',
    })).toBe(true);

    expect(isSameMachineLocality({
      sessionHost: 'WINBOX.local',
      sessionHomeDir: 'C:/Users/Alice',
      currentHost: 'winbox',
      currentHomeDir: 'c:\\users\\alice2\\',
      platform: 'win32',
    })).toBe(false);
  });
});
