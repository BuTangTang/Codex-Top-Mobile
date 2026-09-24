import { describe, expect, it } from 'vitest';

import {
  FilesystemAccessPolicyConfigurationError,
  resolveFilesystemAccessPolicy,
} from './filesystemAccessPolicy';

describe('resolveFilesystemAccessPolicy', () => {
  it('uses the daemon OS user as the default policy when no restriction env is set', () => {
    expect(resolveFilesystemAccessPolicy({ env: {} })).toEqual({ kind: 'osUser' });
  });

  it('uses a single absolute env root as restricted roots policy', () => {
    expect(
      resolveFilesystemAccessPolicy({
        env: { HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: '/srv/project' },
      }),
    ).toEqual({ kind: 'restrictedRoots', roots: ['/srv/project'] });
  });

  it('parses comma-delimited roots in stable order', () => {
    expect(
      resolveFilesystemAccessPolicy({
        env: { HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: ' /srv/project, /mnt/work ,, /home/server ' },
      }),
    ).toEqual({ kind: 'restrictedRoots', roots: ['/srv/project', '/mnt/work', '/home/server'] });
  });

  it('dedupes canonical duplicate roots', () => {
    expect(
      resolveFilesystemAccessPolicy({
        env: { HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: '/srv/project,/srv/project/../project' },
      }),
    ).toEqual({ kind: 'restrictedRoots', roots: ['/srv/project'] });
  });

  it('expands home-relative roots with the canonical CLI helper', () => {
    expect(
      resolveFilesystemAccessPolicy({
        env: {
          HOME: '/home/alice',
          HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: '~/project,~\\other',
        },
      }),
    ).toEqual({ kind: 'restrictedRoots', roots: ['/home/alice/project', '/home/alice/other'] });
  });

  it('expands Windows home-relative roots from USERPROFILE when validating Windows policy', () => {
    expect(
      resolveFilesystemAccessPolicy({
        platform: 'win32',
        env: {
          USERPROFILE: 'C:\\Users\\alice',
          HOME: '/home/alice',
          HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: '~\\project,~/other',
        },
      }),
    ).toEqual({
      kind: 'restrictedRoots',
      roots: ['C:\\Users\\alice\\project', 'C:\\Users\\alice\\other'],
    });
  });

  it('fails closed when any configured root is not absolute', () => {
    expect(() =>
      resolveFilesystemAccessPolicy({
        env: { HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: '/srv/project,relative/path' },
      }),
    ).toThrow(FilesystemAccessPolicyConfigurationError);
  });

  it('fails closed when the configured env contains no usable roots', () => {
    expect(() =>
      resolveFilesystemAccessPolicy({
        env: { HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: ', ,' },
      }),
    ).toThrow(FilesystemAccessPolicyConfigurationError);
  });
});
