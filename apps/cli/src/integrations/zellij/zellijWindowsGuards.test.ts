import { describe, expect, it } from 'vitest';

import { resolveZellijWindowsGuard } from './zellijWindowsGuards';

describe('resolveZellijWindowsGuard', () => {
  it('allows non-Windows zellij hosts', () => {
    expect(resolveZellijWindowsGuard({ platform: 'linux', arch: 'x64', env: {} })).toMatchObject({
      status: 'ok',
    });
  });

  it('disables Windows arm64 because zellij has no upstream binary', () => {
    expect(resolveZellijWindowsGuard({ platform: 'win32', arch: 'arm64', env: {} })).toMatchObject({
      status: 'disabled',
      reason: 'windows_arm64_unsupported',
    });
  });

  it('disables native Windows zellij from legacy Windows Console Host until validated', () => {
    expect(
      resolveZellijWindowsGuard({
        platform: 'win32',
        arch: 'x64',
        env: { WT_SESSION: '', TERM_PROGRAM: '' },
        parentProcessName: 'conhost.exe',
      }),
    ).toMatchObject({ status: 'disabled', reason: 'windows_zellij_unvalidated' });
  });

  it('disables native Windows zellij when no terminal host marker is present until validated', () => {
    expect(
      resolveZellijWindowsGuard({
        platform: 'win32',
        arch: 'x64',
        env: { WT_SESSION: '', TERM_PROGRAM: '' },
      }),
    ).toMatchObject({ status: 'disabled', reason: 'windows_zellij_unvalidated' });
  });

  it('disables native Windows zellij inside Windows Terminal until validated', () => {
    expect(resolveZellijWindowsGuard({ platform: 'win32', arch: 'x64', env: { WT_SESSION: 'abc' } })).toMatchObject({
      status: 'disabled',
      reason: 'windows_zellij_unvalidated',
    });
  });
});
