import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';
import { configuration } from '@/configuration';
import { buildCodexSpawnRuntimeAffinityCompatFields } from '@happier-dev/agents';
import { resolvePathForComparison } from '@/utils/path/normalizePathForComparison';

import { createCodexDirectSessionFollowLease } from './createCodexDirectSessionFollowLease';
import {
  mergeDirectSessionEnvironmentVariables,
  type DirectSessionProviderOps,
} from '@/backends/directSessions/providerOps';

import { getCodexDirectSessionActivity } from './getCodexDirectSessionActivity';
import { getCodexDirectSessionWorkingDirectory } from './getCodexDirectSessionWorkingDirectory';
import { listCodexSessionCandidates } from './listCodexSessionCandidates';
import { pageCodexTranscript } from './pageCodexTranscript';
import { readAfterCodexTranscript } from './readAfterCodexTranscript';
import { resolveCodexHomeEntriesForDirectSessionsSource } from './resolveCodexHomeEntriesForDirectSessionsSource';
import { resolveCodexAppServerProcessEnv } from '../appServer/resolveCodexAppServerProcessEnv';
import { getDesktopSessionControl, sendDesktopSessionUserMessage, getDesktopSessionControlSnapshot, performDesktopSessionControlAction } from './desktop/desktopSessionControl';
import { DirectSessionsProviderUnavailableError } from '@/backends/directSessions/providerOps';
import { readDesktopProjects } from './desktop/readDesktopProjects';

// 这些字段只记录普通文本的 UI 来源和设置快照；实际运行设置仍继承 Desktop。
const DESKTOP_TEXT_TRACKING_META_KEYS = new Set([
  'source', 'sentFrom', 'permissionMode', 'model', 'fallbackModel', 'displayText',
]);

export const codexDirectSessionProviderOps: DirectSessionProviderOps = {
  /** 使用与历史浏览相同的来源解析，再只读原桌面保存的项目集合。 */
  listProjects: async ({ source }) => {
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: configuration.activeServerDir, env: process.env });
    if (homes.length !== 1) throw new DirectSessionsProviderUnavailableError('source_unavailable');
    return readDesktopProjects(homes[0]!.codexHome);
  },
  /** 沿规范来源找到唯一 Codex home；聚合来源不能作为控制目标。 */
  readControl: async ({ source, remoteSessionId }) => {
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: configuration.activeServerDir, env: process.env });
    if (homes.length !== 1) throw new DirectSessionsProviderUnavailableError('source_unavailable');
    return getDesktopSessionControlSnapshot({ codexHome: homes[0]!.codexHome, remoteSessionId });
  },
  /** 保留账号和原生任务身份，不通过 spawn 或 resume 降级执行。 */
  control: async ({ source, remoteSessionId, accountId, action }) => {
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: configuration.activeServerDir, env: process.env });
    if (homes.length !== 1) return { status: 'rejected', reason: 'source_unavailable' };
    return performDesktopSessionControlAction({ codexHome: homes[0]!.codexHome, remoteSessionId, accountId, action });
  },
  listCandidates: async ({ source, cursor, limit, searchTerm, searchMode }) => {
    const res = await listCodexSessionCandidates({ source, activeServerDir: configuration.activeServerDir, serverScope: resolveServerHttpBaseUrl(), cursor, limit, searchTerm, searchMode });
    return { candidates: res.candidates, nextCursor: res.nextCursor ?? null, ...(res.searchIncomplete ? { searchIncomplete: true } : {}) };
  },
  getActivity: async ({ source, remoteSessionId }) => {
    const res = await getCodexDirectSessionActivity({ source, activeServerDir: configuration.activeServerDir, remoteSessionId });
    return {
      lastActivityAtMs: typeof res.lastActivityAtMs === 'number' && Number.isFinite(res.lastActivityAtMs) ? res.lastActivityAtMs : null,
      isRunning: false,
    };
  },
  /** 用既有 home resolver 消除默认值与等价路径差异，只有同一精确目标才能展示能力。 */
  getExternalControl: async ({ source, requestedSource, remoteSessionId }) => {
    const [linkedHomes, requestedHomes] = await Promise.all([source, requestedSource].map((candidate) =>
      resolveCodexHomeEntriesForDirectSessionsSource({ source: candidate, activeServerDir: configuration.activeServerDir, env: process.env })));
    if (linkedHomes.length !== 1 || requestedHomes.length !== 1) {
      return { canSend: false, unavailableReason: 'source_unavailable' };
    }
    const linked = linkedHomes[0]!;
    const requested = requestedHomes[0]!;
    const [linkedPath, requestedPath] = await Promise.all([
      resolvePathForComparison(linked.codexHome), resolvePathForComparison(requested.codexHome),
    ]);
    const identityKeys = ['kind', 'home', 'connectedServiceId', 'connectedServiceProfileId', 'connectedServiceGroupId'] as const;
    if (!linkedPath || linkedPath !== requestedPath || identityKeys.some((key) => linked.source[key] !== requested.source[key])) {
      return { canSend: false, unavailableReason: 'source_mismatch' };
    }
    const control = await getDesktopSessionControl({ codexHome: linked.codexHome, remoteSessionId });
    return control.available ? { canSend: true } : { canSend: false, unavailableReason: control.reason };
  },
  /** 纯文本向现有 Desktop owner 投递；不支持的输入必须拒绝，不能静默丢弃。 */
  send: async ({ source, remoteSessionId, text, localId, meta, accountId }) => {
    if (Object.keys(meta).some((key) => !DESKTOP_TEXT_TRACKING_META_KEYS.has(key))) {
      return { status: 'rejected', reason: 'unsupported_input' };
    }
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({
      source, activeServerDir: configuration.activeServerDir, env: process.env,
    });
    if (homes.length !== 1) return { status: 'rejected', reason: 'source_unavailable' };
    return sendDesktopSessionUserMessage({ codexHome: homes[0]!.codexHome, remoteSessionId, text, localId, accountId });
  },
  pageTranscript: async ({ source, remoteSessionId, direction, cursor, maxBytes, maxItems }) => {
    const res = await pageCodexTranscript({
      source,
      activeServerDir: configuration.activeServerDir,
      remoteSessionId,
      direction,
      cursor,
      maxBytes,
      maxItems,
    });
    return {
      items: res.items,
      nextCursor: res.nextCursor ?? null,
      tailCursor: res.tailCursor ?? null,
      hasMore: res.hasMore,
      historyAvailability: res.historyAvailability,
      truncated: res.truncated === true,
      ...(res.truncationReason ? { truncationReason: res.truncationReason } : {}),
    };
  },
  readAfterTranscript: async ({ source, remoteSessionId, cursor, maxBytes, maxItems }) => {
    const res = await readAfterCodexTranscript({
      source,
      activeServerDir: configuration.activeServerDir,
      remoteSessionId,
      cursor,
      maxBytes,
      maxItems,
    });
    return { ...res, nextCursor: res.nextCursor ?? null, truncated: res.truncated === true };
    },
    acquireFollowLease: createCodexDirectSessionFollowLease,
    supportsExplicitLifecycleNotifications: true,
    resolveTakeoverSpawnOptions: async ({ linked, sessionId }) => {
      const homeEntries = await resolveCodexHomeEntriesForDirectSessionsSource({
        source: linked.source,
        activeServerDir: configuration.activeServerDir,
        env: process.env,
      });
      const codexHome = homeEntries.length === 1 ? homeEntries[0]?.codexHome ?? null : null;
      const directory =
        linked.sessionPath ??
        (await getCodexDirectSessionWorkingDirectory({
        source: linked.source,
        activeServerDir: configuration.activeServerDir,
        remoteSessionId: linked.remoteSessionId,
        env: process.env,
        }));
      if (!directory || !codexHome) return null;
      const runtimeEnv = await resolveCodexAppServerProcessEnv({
        processEnv: process.env,
        affinity: {
          home: homeEntries[0]?.source.kind === 'codexHome' ? homeEntries[0].source.home : 'user',
          homePath: codexHome,
        },
      });
      return {
        directory,
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      existingSessionId: sessionId,
      resume: linked.remoteSessionId,
      approvedNewDirectoryCreation: true,
      transcriptStorage: 'direct',
      ...buildCodexSpawnRuntimeAffinityCompatFields(
        linked.codexBackendMode ? { backendMode: linked.codexBackendMode } : null,
      ),
      environmentVariables: mergeDirectSessionEnvironmentVariables([{
        CODEX_HOME: codexHome,
        CODEX_SQLITE_HOME: runtimeEnv.CODEX_SQLITE_HOME ?? codexHome,
      }]),
    };
  },
};
