import type { CommandHandler } from '@/cli/commandRegistry';
import { CLI_PRODUCT_CAPABILITIES } from '@/runtime/productCapabilities';
import { normalizeCliArgv, parseCliArgs } from '@/cli/parseArgs';
import { initToolTraceIfEnabled } from '@/agent/tools/trace/toolTrace';
import axios from 'axios';
import { configuration } from '@/configuration';
import { maybeAutoUpdateNotice } from '@/cli/runtime/update/autoUpdateNotice';
import { maybeReexecToRuntime } from '@/cli/runtime/update/runtimeReexec';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../../package.json';
import { resolveNpmPackageNameOverride } from '@happier-dev/cli-common/update';
import { installAxiosProxySupport } from '@/utils/proxy/axiosProxy';
import { ensureWindowsUtf8CodePage } from '@/utils/platform/windows/ensureWindowsUtf8CodePage';
import { installConsoleWriteErrorGuards, shouldInstallConsoleWriteErrorGuards } from '@/utils/writeConsoleBestEffort';
import { logger } from '@/ui/logger';
import { applyStackSessionPriority } from '@/utils/process/applyStackSessionPriority';

export type CliEntrypointOptions = Readonly<{ dispatch: CommandHandler; moduleUrl: string }>;

/** 保留原引导顺序；发布策略由同一构建能力事实决定。 */
export async function runCliMain(options: CliEntrypointOptions): Promise<void> {
  applyStackSessionPriority();
  // Best-effort Windows console hardening for Unicode output (workaround for upstream reports of mojibake when
  // launching via npm-generated wrappers). Opt-out via HAPPIER_WINDOWS_UTF8_CODEPAGE=0.
  ensureWindowsUtf8CodePage();
  if (shouldInstallConsoleWriteErrorGuards({ processVersions: process.versions })) {
    installConsoleWriteErrorGuards();
  }
  initToolTraceIfEnabled();
  installAxiosProxySupport({ axios, env: process.env });
  const cliRootDir = dirname(dirname(fileURLToPath(options.moduleUrl)));
  const normalizedArgv = normalizeCliArgv(process.argv.slice(2));
  // Codex Top 随 App 更新，不能跳到 HOME 下的泛用 runtime 或触发 self check。
  if (CLI_PRODUCT_CAPABILITIES.id === 'happier') {
    const updatePackageName = resolveNpmPackageNameOverride({
      envValue: process.env.HAPPIER_CLI_UPDATE_PACKAGE_NAME,
      fallback: packageJson.name,
    });
    await maybeReexecToRuntime({
      argv: normalizedArgv,
      cliRootDir,
      homeDir: configuration.happyHomeDir,
      publicReleaseRing: configuration.publicReleaseRing,
      packageName: updatePackageName,
      env: process.env,
    });
    maybeAutoUpdateNotice({
      argv: normalizedArgv,
      isTTY: Boolean(process.stderr.isTTY),
      homeDir: configuration.happyHomeDir,
      cliRootDir,
      env: process.env,
      publicReleaseRing: configuration.publicReleaseRing,
    });
  }
  const { args, terminalRuntime } = parseCliArgs(normalizedArgv);
  await options.dispatch({ args, terminalRuntime, rawArgv: process.argv });
}

/** 默认和产品入口共用完整错误出口与构建完整性探针。 */
export function runCliEntrypoint(options: CliEntrypointOptions): void {
  if (process.env.HAPPIER_CLI_DIST_INTEGRITY_PROBE !== '1') {
    void runCliMain(options).catch((error) => {
      logger.fatal(error);
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      if (process.env.DEBUG) {
        console.error(error);
      }
      process.exitCode = 1;
    });
  }
}
