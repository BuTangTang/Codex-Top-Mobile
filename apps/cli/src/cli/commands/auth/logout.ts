import chalk from 'chalk';
import { existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  clearCredentials,
  readCredentials,
  updateSettings,
} from '@/persistence';
import { configuration } from '@/configuration';
import { stopDaemon, inspectDaemonRunningStateAndCleanupStaleState } from '@/daemon/controlClient';
import { stopAllDaemonsBestEffort } from '@/daemon/multiDaemon';
import { printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { clearServerScopedAuthStateInSettings } from './clearServerScopedAuthState';

/** 自动化退出只作用当前端，确认连接进程已停止后才清除本端凭据。 */
export async function handleAuthLogout(args: string[]): Promise<void> {
  if (args.includes('--json')) {
    const kind = 'auth_logout';
    if (args.length !== 2 || !args.includes('--yes')) {
      await printJsonEnvelope({ ok: false, kind, error: { code: 'invalid_arguments' } }); return;
    }
    const serverId = configuration.activeServerId;
    const credentialPath = configuration.privateKeyFile;
    try {
      await stopDaemon();
      const state = await inspectDaemonRunningStateAndCleanupStaleState();
      if (state.status !== 'not-running') {
        await printJsonEnvelope({ ok: false, kind, error: { code: 'daemon_stop_failed' } }); return;
      }
      if (configuration.activeServerId !== serverId || configuration.privateKeyFile !== credentialPath) {
        await printJsonEnvelope({ ok: false, kind, error: { code: 'logout_cancelled' } }); return;
      }
      await clearCredentials();
      // 底层兼容清理会吞掉文件删除错误，重新读回后才能确认本端确实退出。
      if (await readCredentials()) {
        await printJsonEnvelope({ ok: false, kind, error: { code: 'logout_failed' } }); return;
      }
      await updateSettings((settings) => clearServerScopedAuthStateInSettings(settings, serverId));
      await printJsonEnvelope({ ok: true, kind, data: { loggedOut: true } });
    } catch {
      await printJsonEnvelope({ ok: false, kind, error: { code: 'logout_failed' } });
    }
    return;
  }
  const logoutAll = args.includes('--all');
  const happyDir = configuration.happyHomeDir;
  const targetServerId = configuration.activeServerId;

  if (!logoutAll) {
    const credentials = await readCredentials();
    if (!credentials) {
      console.log(chalk.yellow('Not currently authenticated'));
      return;
    }
  }

  if (logoutAll) {
    console.log(chalk.blue('This will log you out of Happier on all relays and remove local data'));
  } else {
    console.log(chalk.blue(`This will log you out of Happier for relay: ${targetServerId}`));
  }
  console.log(chalk.yellow('⚠️  You will need to re-authenticate to use Happier again'));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      chalk.yellow(logoutAll
        ? 'Are you sure you want to log out everywhere and delete local data? (y/N): '
        : 'Are you sure you want to log out? (y/N): '),
      resolve,
    );
  });

  rl.close();

  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    try {
      if (logoutAll) {
        try {
          await stopAllDaemonsBestEffort();
        } catch {
          // best-effort
        }
        if (existsSync(happyDir)) {
          rmSync(happyDir, { recursive: true, force: true });
        }
      } else {
        try {
          await stopDaemon();
          console.log(chalk.gray('Stopped daemon'));
        } catch {
          // ignore
        }

        await clearCredentials();

        await updateSettings((settings) => {
          return clearServerScopedAuthStateInSettings(settings, targetServerId);
        });
      }

      console.log(chalk.green('✓ Successfully logged out'));
      console.log(chalk.gray('  Run "happier auth login" to authenticate again'));
    } catch (error) {
      throw new Error(`Failed to logout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return;
  }

  console.log(chalk.blue('Logout cancelled'));
}
