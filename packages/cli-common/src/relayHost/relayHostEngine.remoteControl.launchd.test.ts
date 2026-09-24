import { describe, expect, it } from 'vitest';

describe('RelayHostEngine (remote launchd control)', () => {
  it('uses the remote uid when restarting a user launchd relay over ssh', async () => {
    const remoteCommands: string[] = [];
    const { createRelayHostEngine } = await import('./relayHostEngine.js');

    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'darwin', arch: 'arm64' }),
      runRemoteText: async ({ remoteCommand }) => {
        remoteCommands.push(remoteCommand);
        if (remoteCommand.includes('printf') && remoteCommand.includes('$HOME')) {
          return { status: 0, stdout: '/Users/remote-user\n', stderr: '' };
        }
        if (remoteCommand.includes('HAPPIER_RELAY_HEALTH_OK') || remoteCommand.includes('HEALTH_URL=')) {
          return { status: 0, stdout: 'HAPPIER_RELAY_HEALTH_OK\n', stderr: '' };
        }
        if (remoteCommand.includes('server.env')) {
          return { status: 0, stdout: 'PORT=3005\nHAPPIER_SERVER_HOST=127.0.0.1\n', stderr: '' };
        }
        if (remoteCommand.includes('if [ -f ')) {
          return { status: 0, stdout: 'yes\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => ({
        binaryPath: '$HOME/.happier/happier-server/current/happier-server',
        versionId: 'publicdev-1',
      }),
    });

    await expect(engine.control({
      target: {
        kind: 'ssh',
        ssh: {
          target: 'dev@example.test',
          auth: 'agent',
        },
      },
      mode: 'user',
      channel: 'preview',
      action: 'restart',
    })).resolves.toBeUndefined();

    const kickstartCommand = remoteCommands.find((cmd) => cmd.includes('launchctl kickstart -k'));
    expect(kickstartCommand).toBeTruthy();
    expect(kickstartCommand).toContain('gui/$(id -u)/happier-server-preview');
    expect(kickstartCommand).not.toContain(`gui/${typeof process.getuid === 'function' ? process.getuid() : 0}/happier-server-preview`);
  }, 60_000);
});
