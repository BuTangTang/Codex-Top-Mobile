import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cliRoot = fileURLToPath(new URL('../../', import.meta.url));
const memoryIds = ['memory.search', 'memory.get_window', 'memory.ensure_up_to_date'];

/** 编译真实设置消费者，产品选择只发生于构建别名，不替换内部实现。 */
async function loadSettings(product: boolean): Promise<{
  inspect(settings: unknown): Promise<{
    sameAccountObject: boolean;
    accountEnabled: boolean[];
    envEnabled: boolean[];
    disabled: string[];
    memoryGuidance: boolean;
    unrelatedAction: unknown;
  }>;
  dispose(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'happier-product-actions-'));
  try {
    await symlink(join(cliRoot, '../../node_modules'), join(directory, 'node_modules'), 'dir');
    const result = await build({
      absWorkingDir: cliRoot,
      stdin: {
        contents: `
          import { isActionEnabledByEnv, listDisabledActionIdsForSurfaceFromEnv } from '@/settings/actionsSettings';
          import { createMcpActionSettingsProvider, createMcpActionEnablement } from '@/mcp/server/createMcpActionEnablement';
          import { resolveCliMemoryRecallGuidanceEnabled } from '@/agent/promptLibrary/resolveCliMemoryRecallGuidanceEnabled';
          export async function inspect(settings) {
            const provider = createMcpActionSettingsProvider({ getAccountSettings: () => ({ actionsSettingsV1: settings }) });
            const enabled = createMcpActionEnablement({ actionSettingsProvider: provider, surface: 'session_agent' });
            const ids = ${JSON.stringify(memoryIds)};
            return {
              sameAccountObject: provider.getActionsSettings() === settings,
              accountEnabled: ids.map(enabled),
              envEnabled: ids.map(id => isActionEnabledByEnv(id, {surface:'session_agent'})),
              disabled: listDisabledActionIdsForSurfaceFromEnv('session_agent'),
              memoryGuidance: await resolveCliMemoryRecallGuidanceEnabled({deps:{readMemorySettingsFromDisk:async()=>({enabled:true})}}),
              unrelatedAction: provider.getActionsSettings().actions['review.start'],
            };
          }`,
        resolveDir: `${cliRoot}src`, loader: 'ts',
      },
      bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external',
      alias: {
        ...(product ? { '@/runtime/productCapabilities': `${cliRoot}src/runtime/profiles/codexTopCapabilities.ts` } : {}),
        '@': `${cliRoot}src`,
      },
      logLevel: 'silent',
    });
    const entry = join(directory, 'settings.mjs');
    await writeFile(entry, result.outputFiles[0]!.contents);
    const module = await import(pathToFileURL(entry).href);
    return { inspect: module.inspect, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

afterEach(() => vi.unstubAllEnvs());

describe('product action capability projection', () => {
  it.each([false, true])('enforces product=%s without changing account data or unrelated actions', async (product) => {
    const override = Object.freeze({ enabled: true, enabledPlacements: [], disabledSurfaces: [], disabledPlacements: [], approvalRequiredSurfaces: [], toolExposureModes: {} });
    const actions = Object.freeze({ ...Object.fromEntries(memoryIds.map(id => [id, override])), 'review.start': Object.freeze({ ...override, enabled: false }) });
    const settings = Object.freeze({ v: 1, actions });
    vi.stubEnv('HAPPIER_ACTIONS_SETTINGS_V1', JSON.stringify(settings));
    const runtime = await loadSettings(product);
    try {
      const result = await runtime.inspect(settings);
      expect(result.envEnabled).toEqual(memoryIds.map(() => !product));
      expect(result.accountEnabled).toEqual(memoryIds.map(() => !product));
      expect(result.memoryGuidance).toBe(!product);
      expect(result.sameAccountObject).toBe(!product);
      expect(result.unrelatedAction).toEqual(actions['review.start']);
      expect(result.disabled).toEqual(expect.arrayContaining(product ? [...memoryIds, 'review.start'] : ['review.start']));
      expect(override.enabled).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
});
