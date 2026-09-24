import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tweetnacl from 'tweetnacl';

function serializeIdentity(identity: unknown): string {
  return JSON.stringify(identity, null, 2);
}

function createTestIdentity(params: Readonly<{
  installationId: string;
  createdAt?: number;
  publicKeyBytes?: Uint8Array;
  privateKeyBytes?: Uint8Array;
}>): unknown {
  const keyPair = tweetnacl.sign.keyPair();
  return {
    version: 1,
    installationId: params.installationId,
    createdAt: params.createdAt ?? 1,
    publicKey: Buffer.from(params.publicKeyBytes ?? keyPair.publicKey).toString('base64url'),
    privateKey: Buffer.from(params.privateKeyBytes ?? keyPair.secretKey).toString('base64url'),
  };
}

describe('installation identity store', () => {
  const previousHomeDir = process.env.HAPPIER_HOME_DIR;

  afterEach(() => {
    if (previousHomeDir === undefined) delete process.env.HAPPIER_HOME_DIR;
    else process.env.HAPPIER_HOME_DIR = previousHomeDir;
    vi.resetModules();
    vi.doUnmock('node:fs/promises');
  });

  it('mints one local installation identity and persists it with private file permissions', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const { readOrCreateInstallationIdentity } = await import('./store');

      const first = await readOrCreateInstallationIdentity();
      const second = await readOrCreateInstallationIdentity();

      expect(second).toEqual(first);
      expect(first.version).toBe(1);
      expect(first.installationId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(first.publicKey).toEqual(expect.any(String));
      expect(first.privateKey).toEqual(expect.any(String));
      expect(existsSync(configuration.installationIdentityFile)).toBe(true);
      expect(JSON.parse(readFileSync(configuration.installationIdentityFile, 'utf8'))).toEqual(first);
      if (process.platform !== 'win32') {
        expect(statSync(configuration.installationIdentityFile).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('fails clearly instead of silently replacing a corrupt identity file', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-corrupt-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(homeDir, 'servers', configuration.activeServerId), { recursive: true });
      writeFileSync(configuration.installationIdentityFile, '{"version":1,"installationId":""}', 'utf8');

      const { readOrCreateInstallationIdentity } = await import('./store');
      await expect(readOrCreateInstallationIdentity()).rejects.toThrow(/installation identity/i);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('fails clearly when persisted key material is malformed', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-bad-key-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      mkdirSync(join(homeDir, 'servers', configuration.activeServerId), { recursive: true });
      writeFileSync(
        configuration.installationIdentityFile,
        serializeIdentity(createTestIdentity({
          installationId: 'installation-1',
          publicKeyBytes: new Uint8Array(31),
        })),
        'utf8',
      );

      const { readOrCreateInstallationIdentity } = await import('./store');
      await expect(readOrCreateInstallationIdentity()).rejects.toThrow(/publicKey/i);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('reads the identity that won a concurrent first-use create race', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-race-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const identityPath = configuration.installationIdentityFile;
      const { readOrCreateInstallationIdentity } = await import('./store');
      const [first, second] = await Promise.all([
        readOrCreateInstallationIdentity(identityPath),
        readOrCreateInstallationIdentity(identityPath),
      ]);

      expect(second).toEqual(first);
      expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual(first);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('waits for an in-progress first-use create to publish the completed identity', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-publish-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const identityPath = configuration.installationIdentityFile;
      const lockPath = `${identityPath}.lock`;
      const winner = createTestIdentity({
        installationId: 'published-installation',
        createdAt: 456,
      });
      mkdirSync(join(homeDir, 'servers', configuration.activeServerId), { recursive: true });
      writeFileSync(lockPath, `${process.pid}`, { encoding: 'utf8', mode: 0o600 });

      let publishTimer: ReturnType<typeof setTimeout> | null = null;
      const published = new Promise<void>((resolve) => {
        publishTimer = setTimeout(() => {
          publishTimer = null;
          writeFileSync(identityPath, serializeIdentity(winner), { encoding: 'utf8', mode: 0o600 });
          unlinkSync(lockPath);
          resolve();
        }, 20);
      });

      try {
        const { readOrCreateInstallationIdentity } = await import('./store');
        await expect(readOrCreateInstallationIdentity(identityPath)).resolves.toEqual(winner);
        await published;
      } finally {
        if (publishTimer) clearTimeout(publishTimer);
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('recovers a stale first-use creation lock without exposing a partial identity file', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-stale-lock-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const identityPath = configuration.installationIdentityFile;
      const lockPath = `${identityPath}.lock`;
      mkdirSync(join(homeDir, 'servers', configuration.activeServerId), { recursive: true });
      writeFileSync(lockPath, 'crashed-process\n', { encoding: 'utf8', mode: 0o600 });
      const staleDate = new Date(Date.now() - 60_000);
      utimesSync(lockPath, staleDate, staleDate);

      const { readOrCreateInstallationIdentity } = await import('./store');
      const identity = await readOrCreateInstallationIdentity(identityPath);

      expect(existsSync(lockPath)).toBe(false);
      expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual(identity);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('does not let a stalled stale-lock creator overwrite the published winner', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-stale-publish-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const identityPath = configuration.installationIdentityFile;
      const lockPath = `${identityPath}.lock`;

      let firstFinalPublishStarted: () => void = () => {
        throw new Error('first final publish resolver was not initialized');
      };
      const firstFinalPublishStartedPromise = new Promise<void>((resolve) => {
        firstFinalPublishStarted = resolve;
      });
      let resumeFirstFinalPublish: () => void = () => {
        throw new Error('resume final publish resolver was not initialized');
      };
      const resumeFirstFinalPublishPromise = new Promise<void>((resolve) => {
        resumeFirstFinalPublish = resolve;
      });
      let finalPublishAttempts = 0;

      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        async function maybePauseFirstFinalPublish(
          from: Parameters<typeof actual.rename>[0],
          to: Parameters<typeof actual.rename>[1],
          publish: () => Promise<void>,
        ): Promise<void> {
          if (String(to) === identityPath && String(from).endsWith('.tmp')) {
            finalPublishAttempts += 1;
            if (finalPublishAttempts === 1) {
              firstFinalPublishStarted();
              await resumeFirstFinalPublishPromise;
            }
          }
          await publish();
        }
        return {
          ...actual,
          link: async (
            existingPath: Parameters<typeof actual.link>[0],
            newPath: Parameters<typeof actual.link>[1],
          ) => maybePauseFirstFinalPublish(
            existingPath,
            newPath,
            () => actual.link(existingPath, newPath),
          ),
          rename: async (
            oldPath: Parameters<typeof actual.rename>[0],
            newPath: Parameters<typeof actual.rename>[1],
          ) => maybePauseFirstFinalPublish(
            oldPath,
            newPath,
            () => actual.rename(oldPath, newPath),
          ),
        };
      });

      const { readOrCreateInstallationIdentity } = await import('./store');
      const stalledCreator = readOrCreateInstallationIdentity(identityPath);
      await firstFinalPublishStartedPromise;

      expect(existsSync(identityPath)).toBe(false);
      const staleDate = new Date(Date.now() - 60_000);
      utimesSync(lockPath, staleDate, staleDate);

      const recoveredWinner = await readOrCreateInstallationIdentity(identityPath);
      expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual(recoveredWinner);

      resumeFirstFinalPublish();
      await expect(stalledCreator).resolves.toEqual(recoveredWinner);
      expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual(recoveredWinner);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('sync creation reads the published winner when another process wins final publish', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-sync-publish-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const identityPath = configuration.installationIdentityFile;
      const winner = createTestIdentity({
        installationId: 'sync-published-winner',
        createdAt: 789,
      });

      vi.doMock('node:fs', async () => {
        const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
        return {
          ...actual,
          linkSync: (
            existingPath: Parameters<typeof actual.linkSync>[0],
            newPath: Parameters<typeof actual.linkSync>[1],
          ) => {
            if (String(newPath) === identityPath && !actual.existsSync(newPath)) {
              actual.writeFileSync(newPath, serializeIdentity(winner), { encoding: 'utf8', mode: 0o600 });
            }
            return actual.linkSync(existingPath, newPath);
          },
        };
      });

      const { readOrCreateInstallationIdentitySync } = await import('./store');

      expect(readOrCreateInstallationIdentitySync(identityPath)).toEqual(winner);
      expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual(winner);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('survives credential and machine-id clearing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-clear-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { readOrCreateInstallationIdentity } = await import('./store');
      const { clearCredentials, clearMachineId } = await import('@/persistence');

      const before = await readOrCreateInstallationIdentity();
      await clearCredentials();
      await clearMachineId();

      await expect(readOrCreateInstallationIdentity()).resolves.toEqual(before);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('can read an existing identity without minting one when absent', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-installation-identity-read-existing-'));
    process.env.HAPPIER_HOME_DIR = homeDir;

    try {
      vi.resetModules();
      const { configuration } = await import('@/configuration');
      const {
        readInstallationIdentityIfExistsSync,
        readOrCreateInstallationIdentity,
      } = await import('./store');

      expect(readInstallationIdentityIfExistsSync()).toBeNull();
      expect(existsSync(configuration.installationIdentityFile)).toBe(false);

      const created = await readOrCreateInstallationIdentity();
      expect(readInstallationIdentityIfExistsSync()).toEqual(created);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
