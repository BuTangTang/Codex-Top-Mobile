import type {
  DirectSessionCandidateV1,
  DirectSessionsSource,
  DirectTranscriptRawMessageV1,
  DirectTranscriptTruncationReason,
  DirectTranscriptHistoryAvailability,
  DirectSessionObservationV1,
  DesktopControlSnapshotV1,
  DirectSessionControlActionRequest,
  DirectSessionControlResult,
  DesktopProjectV1,
} from '@happier-dev/protocol';

import type {
  DirectSessionFollowLease,
  DirectSessionFollowLeaseReason,
} from '@/api/directSessions/backgroundFollow/createManagedDirectSessionFollowLease';
import type { LoadedLinkedDirectSession } from '@/api/directSessions/takeover/loadLinkedDirectSession';
import type { SpawnSessionOptions } from '@/rpc/handlers/registerSessionHandlers';

export type DirectSessionCandidatesPage = Readonly<{
  candidates: DirectSessionCandidateV1[];
  nextCursor: string | null;
  searchIncomplete?: boolean;
  capabilities?: Readonly<{
    deleteCandidate: boolean;
  }>;
}>;

export type DirectSessionActivitySample = Readonly<{
  lastActivityAtMs: number | null;
  isRunning: boolean;
  observation?: DirectSessionObservationV1;
}>;

/** 外部 owner 的发送能力独立于 Happier runner，不代表已接管会话。 */
export type DirectSessionExternalControl = Readonly<{
  canSend: boolean;
  unavailableReason?: string;
}>;

/** 已接收、明确拒绝与结果未知必须分别保留，调用方不得据此自动接管重试。 */
export type DirectSessionExternalSendResult =
  | Readonly<{ status: 'accepted' }>
  | Readonly<{ status: 'rejected' | 'unknown'; reason: string }>;

export type DirectSessionTranscriptPage = Readonly<{
  historyAvailability?: DirectTranscriptHistoryAvailability;
  items: DirectTranscriptRawMessageV1[];
  nextCursor: string | null;
  tailCursor: string | null;
  hasMore: boolean;
  truncated: boolean;
  truncationReason?: DirectTranscriptTruncationReason;
}>;

export type DirectSessionTranscriptReadAfter = Readonly<{
  historyAvailability?: DirectTranscriptHistoryAvailability;
  items: DirectTranscriptRawMessageV1[];
  nextCursor: string | null;
  truncated: boolean;
  truncationReason?: DirectTranscriptTruncationReason;
}>;

/** 续页依据已失效；仅候选列表 RPC 将其转换为保留当前页的刷新提示。 */
export class DirectSessionsCandidateCursorError extends Error {
  constructor() {
    super('direct_sessions_list_refresh_required');
    this.name = 'DirectSessionsCandidateCursorError';
  }
}

/**
 * A direct-sessions operation the resolved provider genuinely cannot perform for this source.
 * Callers map it to `provider_unavailable` so the surface degrades truthfully instead of reporting
 * an internal error or an empty-but-successful result.
 */
export class DirectSessionsProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectSessionsProviderUnavailableError';
  }
}

/**
 * Transcript, activity and takeover members are optional: a resume-only source (ACP `session/list`)
 * can enumerate candidates without owning the provider's transcript store or process lifecycle.
 */
export type DirectSessionProviderOps = Readonly<{
  /** 仅 LINK 明确打开已有任务时调用；后台状态、续租和发送不能触发桌面跳转。 */
  openExistingSession?: (params: Readonly<{ source: DirectSessionsSource; remoteSessionId: string; isCurrent: () => boolean }>) => Promise<void>;
  listCandidates: (params: Readonly<{
    source: DirectSessionsSource;
    cursor?: string;
    limit: number;
    searchTerm?: string;
    searchMode?: 'fast' | 'full';
  }>) => Promise<DirectSessionCandidatesPage>;
  deleteCandidate?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
  }>) => Promise<void>;
  getActivity?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
  }>) => Promise<DirectSessionActivitySample>;
  /** source 是认证关联的来源；provider 必须先核对 requestedSource 的规范身份再探测。 */
  getExternalControl?: (params: Readonly<{
    source: DirectSessionsSource;
    requestedSource: DirectSessionsSource;
    remoteSessionId: string;
  }>) => Promise<DirectSessionExternalControl>;
  /** 只读原 owner 当前请求，关联与账号归属由机器 RPC 固定。 */
  readControl?: (params: Readonly<{ source: DirectSessionsSource; remoteSessionId: string }>) => Promise<DesktopControlSnapshotV1>;
  /** 浏览真实桌面项目配置，不承诺原生创建入口已经可用。 */
  listProjects?: (params: Readonly<{ source: DirectSessionsSource }>) => Promise<DesktopProjectV1[]>;
  /** 同原 owner 审批或忙时追加，未知结果不得自动重发。 */
  control?: (params: Readonly<{ source: DirectSessionsSource; remoteSessionId: string; accountId: string; action: DirectSessionControlActionRequest }>) => Promise<DirectSessionControlResult>;
  /** 只向关联目标现有 owner 投递；禁止启动、恢复或接管执行器作为降级路径。 */
  send?: (params: Readonly<{
    /** 本次 RPC 已认证的账号快照，去重分区不得重新读取可变凭据。 */
    accountId: string;
    source: DirectSessionsSource;
    remoteSessionId: string;
    text: string;
    localId: string;
    meta: Readonly<Record<string, unknown>>;
  }>) => Promise<DirectSessionExternalSendResult>;
  pageTranscript?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
    direction: 'older' | 'newer';
    cursor?: string;
    maxBytes: number;
    maxItems: number;
  }>) => Promise<DirectSessionTranscriptPage>;
  readAfterTranscript?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
    cursor: string;
    maxBytes: number;
    maxItems: number;
  }>) => Promise<DirectSessionTranscriptReadAfter>;
  acquireFollowLease?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
    reason: DirectSessionFollowLeaseReason;
    initialCursor?: string;
  }>) => Promise<DirectSessionFollowLease | null>;
  supportsExplicitLifecycleNotifications?: boolean;
  resolveTakeoverSpawnOptions?: (params: Readonly<{
    linked: LoadedLinkedDirectSession;
    sessionId: string;
  }>) => Promise<SpawnSessionOptions | null>;
}>;

export function mergeDirectSessionEnvironmentVariables(values: Array<Record<string, string> | null>): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const value of values) {
    if (!value) continue;
    for (const [key, raw] of Object.entries(value)) {
      const normalized = String(raw ?? '').trim();
      if (!normalized) continue;
      merged[key] = normalized;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
