import { DirectSessionUploadedAttachmentsEnvelopeV1Schema } from '@happier-dev/protocol';
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
import { openDesktopSession } from './desktop/openDesktopSession';
import { DesktopIpc } from './desktop/desktopIpc';

// 这些字段只记录普通文本的 UI 来源和设置快照；实际运行设置仍继承 Desktop。
const DESKTOP_TEXT_TRACKING_META_KEYS = new Set([
  'source', 'sentFrom', 'permissionMode', 'model', 'fallbackModel', 'displayText',
]);

/** 通用链只传递当前 lease；私有连接类型与控制锚仅由 Codex provider 识别。 */
function followedIpc(getFollowLease: Parameters<NonNullable<DirectSessionProviderOps['readControl']>>[0]['getFollowLease']) {
  return () => {
    const value = getFollowLease?.()?.getProviderControl?.();
    return value instanceof DesktopIpc ? value : null;
  };
}

export const codexDirectSessionProviderOps: DirectSessionProviderOps = {
  /** 手机明确打开时复用唯一来源与原任务入口，已加载任务不切换桌面。 */
  openExistingSession: async ({ source, remoteSessionId, isCurrent }) => {
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: configuration.activeServerDir, env: process.env });
    if (homes.length !== 1) throw new DirectSessionsProviderUnavailableError('source_unavailable');
    await openDesktopSession({ codexHome: homes[0]!.codexHome, remoteSessionId, isCurrent });
  },
  /** 使用与历史浏览相同的来源解析，再只读原桌面保存的项目集合。 */
  listProjects: async ({ source }) => {
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: configuration.activeServerDir, env: process.env });
    if (homes.length !== 1) throw new DirectSessionsProviderUnavailableError('source_unavailable');
    return readDesktopProjects(homes[0]!.codexHome);
  },
  /** 沿规范来源找到唯一 Codex home；聚合来源不能作为控制目标。 */
  readControl: async ({ source, remoteSessionId, getFollowLease, includeQuestions }) => {
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: configuration.activeServerDir, env: process.env });
    if (homes.length !== 1) throw new DirectSessionsProviderUnavailableError('source_unavailable');
    return getDesktopSessionControlSnapshot({ codexHome: homes[0]!.codexHome, remoteSessionId, includeQuestions, getFollowedIpc: followedIpc(getFollowLease) });
  },
  /** 保留账号和原生任务身份，不通过 spawn 或 resume 降级执行。 */
  control: async ({ source, remoteSessionId, accountId, action, getFollowLease }) => {
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: configuration.activeServerDir, env: process.env });
    if (homes.length !== 1) return { status: 'rejected', reason: 'source_unavailable' };
    return performDesktopSessionControlAction({ codexHome: homes[0]!.codexHome, remoteSessionId, accountId, action, getFollowedIpc: followedIpc(getFollowLease) });
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
  getExternalControl: async ({ source, requestedSource, remoteSessionId, getFollowLease }) => {
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
    const control = await getDesktopSessionControl({ codexHome: linked.codexHome, remoteSessionId, getFollowedIpc: followedIpc(getFollowLease) });
    return control.available ? { canSend: true, textSendProtocol: 'native-auto-v1' }
      : { canSend: false, unavailableReason: control.reason };
  },
  /** 文本与已上传附件共用原 Desktop owner；不支持的输入明确拒绝。 */
  send: async ({ source, remoteSessionId, text, localId, meta, accountId, getFollowLease }) => {
    // 复用原 meta 透传，只接受明确 opt-in；旧客户端缺字段仍保持 start 契约。
    const nativeAutoText = meta.desktopTextSendProtocol === 'native-auto-v1';
    const envelope = meta.happier === undefined ? null : DirectSessionUploadedAttachmentsEnvelopeV1Schema.safeParse(meta.happier);
    if (envelope && (!envelope.success || !nativeAutoText)) return { status: 'rejected', reason: 'unsupported_input' };
    if (Object.keys(meta).some((key) => !DESKTOP_TEXT_TRACKING_META_KEYS.has(key)
      && !(key === 'desktopTextSendProtocol' && nativeAutoText) && !(key === 'happier' && envelope?.success))) {
      return { status: 'rejected', reason: 'unsupported_input' };
    }
    const homes = await resolveCodexHomeEntriesForDirectSessionsSource({
      source, activeServerDir: configuration.activeServerDir, env: process.env,
    });
    if (homes.length !== 1) return { status: 'rejected', reason: 'source_unavailable' };
    const attachments = envelope?.success ? envelope.data.payload.attachments : undefined;
    const cwd = attachments ? await getCodexDirectSessionWorkingDirectory({ source, activeServerDir: configuration.activeServerDir, remoteSessionId }) : null;
    if (attachments && !cwd) return { status: 'rejected', reason: 'missing_working_directory' };
    return sendDesktopSessionUserMessage({ codexHome: homes[0]!.codexHome, remoteSessionId, text, localId, accountId,
      ...(attachments ? { attachments, attachmentWorkingDirectory: cwd! } : {}),
      ...(nativeAutoText ? { textSendProtocol: 'native-auto-v1' as const } : {}), getFollowedIpc: followedIpc(getFollowLease) });
  },
  pageTranscript: async ({ source, remoteSessionId, direction, cursor, maxBytes, maxItems, projection, scanMaxBytes }) => {
    const res = await pageCodexTranscript({
      source,
      activeServerDir: configuration.activeServerDir,
      remoteSessionId,
      direction,
      cursor,
      maxBytes,
      maxItems,
      projection,
      scanMaxBytes,
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
  readAfterTranscript: async ({ source, remoteSessionId, cursor, maxBytes, maxItems, projection, scanMaxBytes }) => {
    const res = await readAfterCodexTranscript({
      source,
      activeServerDir: configuration.activeServerDir,
      remoteSessionId,
      cursor,
      maxBytes,
      maxItems,
      projection,
      scanMaxBytes,
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
