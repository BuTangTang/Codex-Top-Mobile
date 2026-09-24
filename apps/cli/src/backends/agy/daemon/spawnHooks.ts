import { ensureAgyAcpServerForLaunch } from '@/backends/agy/acp/ensureAgyAcpServerForLaunch';
import type { DaemonSpawnHooks } from '@/daemon/spawnHooks';

export const agyDaemonSpawnHooks: DaemonSpawnHooks = {
  validateSpawn: async ({ environmentVariables }) => {
    try {
      await ensureAgyAcpServerForLaunch({ env: environmentVariables });
    } catch (error) {
      return {
        ok: false,
        reasonCode: 'agy_acp_server_unavailable',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Agy ACP server is not available. Select Agy again to install the pinned server.',
      };
    }
    return { ok: true };
  },
};
