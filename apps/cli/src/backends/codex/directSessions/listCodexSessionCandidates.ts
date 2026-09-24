import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DirectSessionsCandidateCursorError } from '@/backends/directSessions/providerOps';
import { unknownCodexLifecycleV1, type DirectSessionCandidateV1, type DirectSessionsSource } from '@happier-dev/protocol';

import { mapWithConcurrency } from '@/api/directSessions/discovery/mapWithConcurrency';
import { logger } from '@/utils/logger';

import { createCodexAppServerClient } from '../appServer/client/createCodexAppServerClient';
import { listCodexDirectSessionCandidatesViaExistingAppServerClient } from '../appServer/session/listCodexDirectSessionCandidatesViaAppServer';
import { indexCodexDirectSessionCandidatesViaRollouts, resolveRolloutSearchBuildConcurrency } from './listCodexDirectSessionCandidatesViaRollouts';
import type { CodexDirectSessionHomeEntry } from './resolveCodexHomeEntriesForDirectSessionsSource';
import { resolveCodexAppServerProcessEnv } from '../appServer/resolveCodexAppServerProcessEnv';

type IndexCursorV2 = Readonly<{
  v: 2; kind: 'index'; offset: number; scope: string; order: string; searchMode: 'fast' | 'full';
}>;

/** 对本次分页依据计算固定长度摘要，cursor 不携带身份列表或本机路径。 */
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** 游标只能续读同一观察列表；旧版、损坏或越界的 offset 均要求显式刷新。 */
function decodeIndexCursor(raw: string | undefined): IndexCursorV2 | null {
  if (raw === undefined) return null;
  try {
    if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<IndexCursorV2> | null;
    if (!value || Object.keys(value).sort().join(',') !== 'kind,offset,order,scope,searchMode,v' || value.v !== 2 || value.kind !== 'index'
      || !Number.isSafeInteger(value.offset) || value.offset! < 1
      || typeof value.scope !== 'string' || !/^[a-f0-9]{64}$/.test(value.scope)
      || typeof value.order !== 'string' || !/^[a-f0-9]{64}$/.test(value.order)
      || (value.searchMode !== 'fast' && value.searchMode !== 'full')) throw new Error();
    return value as IndexCursorV2;
  } catch {
    throw new DirectSessionsCandidateCursorError();
  }
}

/** 只使用实际来源身份，不依赖对象属性顺序，也不把本机路径写入 cursor。 */
function sourceIdentity(source: DirectSessionsSource): readonly unknown[] {
  if (source.kind !== 'codexHome') return [source.kind];
  return [source.kind, source.home, source.connectedServiceId?.trim() ?? null,
    source.connectedServiceProfileId?.trim() ?? null, source.connectedServiceGroupId?.trim() ?? null,
    source.homePath ? resolve(source.homePath.trim()) : null];
}

function resolveCodexDirectListAppServerBudgetMs(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(String(env.HAPPIER_CODEX_DIRECT_SESSIONS_APP_SERVER_LIST_TIMEOUT_MS ?? ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 750;
}

/** 按可靠索引、现有服务标题、rollout 回退顺序合并，不扩大公开协议。 */
function mergeCodexDirectSessionCandidate(params: Readonly<{
  rolloutCandidate: DirectSessionCandidateV1;
  appServerCandidate: DirectSessionCandidateV1 | undefined;
  indexedTitle?: string;
}>): DirectSessionCandidateV1 {
  // 索引提供明确线程名称；app-server 的 title 可能来自 preview，不能反向覆盖。
  if (params.indexedTitle) return { ...params.rolloutCandidate, title: params.indexedTitle };
  const appServerTitle = params.appServerCandidate?.title?.trim();
  if (!appServerTitle) return params.rolloutCandidate;
  return {
    ...params.rolloutCandidate,
    title: appServerTitle,
  };
}

/** 在既有时间预算内读取各 home，保留来源覆盖与明确排除的身份供统一分页使用。 */
async function listCodexSessionCandidatesViaAppServerWithBudget(params: Readonly<{
  homeEntries: readonly CodexDirectSessionHomeEntry[];
  titlesByHome: ReadonlyMap<string, ReadonlyMap<string, string>>;
  env: NodeJS.ProcessEnv;
  searchTerm?: string;
}>): Promise<Readonly<{ candidates: DirectSessionCandidateV1[]; incomplete: boolean; coverage: boolean[]; excludedSessionIds: ReadonlySet<string> }>> {
  const budgetMs = resolveCodexDirectListAppServerBudgetMs(params.env);
  const listed: DirectSessionCandidateV1[] = [];
  let incomplete = false;
  const coverage: boolean[] = [];
  const excludedSessionIds = new Set<string>();
  const searchTerm = typeof params.searchTerm === 'string' ? params.searchTerm.trim().toLowerCase() : '';
  for (const homeEntry of params.homeEntries) {
    const processEnv = await resolveCodexAppServerProcessEnv({
      processEnv: { ...process.env, ...params.env },
      affinity: {
        home: homeEntry.source.kind === 'codexHome' ? homeEntry.source.home : 'user',
        homePath: homeEntry.codexHome,
      },
    });
    const startedAtMs = Date.now();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let client: Awaited<ReturnType<typeof createCodexAppServerClient>> | null = null;

    const listPromise = (async (): Promise<DirectSessionCandidateV1[] | null> => {
      try {
        client = await createCodexAppServerClient({ processEnv });
        if (timedOut) {
          await client.dispose().catch(() => undefined);
          return null;
        }
        return await listCodexDirectSessionCandidatesViaExistingAppServerClient({ client, processEnv, onExcludedSession: (id) => {
          // 超时后的后台结果不能继续改写本次分页依据。
          if (!timedOut) excludedSessionIds.add(id);
        } });
      } catch {
        return null;
      } finally {
        if (client) {
          await client.dispose().catch(() => undefined);
        }
      }
    })();

    const result = await Promise.race<DirectSessionCandidateV1[] | null>([
      listPromise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          void client?.dispose().catch(() => undefined);
          resolve(null);
        }, budgetMs);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    logger.debug('[directSessions.codex.appServerCandidates] list finished', {
      homeKind: homeEntry.source.kind,
      elapsedMs: Date.now() - startedAtMs,
      budgetMs,
      timedOut,
      returnedCandidates: result?.length ?? 0,
      searchTermLength: searchTerm.length,
    });

    coverage.push(result !== null);
    if (!result) {
      incomplete = true;
      continue;
    }
    listed.push(...result.map((candidate) => ({
      ...candidate,
      // app-server-only 候选也使用本 home 的索引，仍在原搜索范围内过滤。
      title: params.titlesByHome.get(homeEntry.codexHome)?.get(candidate.remoteSessionId) ?? candidate.title,
      details: {
        ...(candidate.details ?? {}),
        source: homeEntry.source,
      },
    })).filter((candidate) => {
      if (!searchTerm) return true;
      const details = candidate.details as Record<string, unknown> | undefined;
      const cwd = typeof details?.cwd === 'string' ? details.cwd : undefined;
      const title = candidate.title;
      const haystack = `${candidate.remoteSessionId}${title ? ` ${title}` : ''}${cwd ? ` ${cwd}` : ''}`.toLowerCase();
      return haystack.includes(searchTerm);
    }));
  }

  return { candidates: listed, incomplete, coverage, excludedSessionIds };
}

/** 先统一两个来源的排除身份及顺序，验证续页依据后才读取所选页面的详情。 */
export async function listCodexSessionCandidates(params: Readonly<{
  source: DirectSessionsSource;
  activeServerDir: string;
  serverScope?: string;
  env?: NodeJS.ProcessEnv;
  cursor?: string;
  limit: number;
  searchTerm?: string;
  searchMode?: 'fast' | 'full';
}>): Promise<Readonly<{ candidates: DirectSessionCandidateV1[]; nextCursor: string | null; searchIncomplete?: boolean }>> {
  const env = params.env ?? process.env;
  const startedAtMs = Date.now();
  const startMemory = process.memoryUsage();
  const cursor = decodeIndexCursor(params.cursor);
  const searchMode = params.searchMode ?? cursor?.searchMode ?? 'full';
  if (cursor && searchMode !== cursor.searchMode) throw new DirectSessionsCandidateCursorError();
  const searchTerm = params.searchTerm?.trim().toLowerCase() ?? '';
  const limit = Math.max(1, Math.trunc(params.limit));
  const rolloutIndex = await indexCodexDirectSessionCandidatesViaRollouts({
    source: params.source, activeServerDir: params.activeServerDir, env, searchTerm, searchMode,
  });
  // 范围绑定真实服务端、实际 homes 和过滤策略；不把分页大小误当身份。
  const scope = fingerprint(['codex-candidates-v2', params.serverScope ?? null, resolve(params.activeServerDir),
    sourceIdentity({ ...params.source, homePath: undefined } as DirectSessionsSource),
    rolloutIndex.homeEntries.map((entry) => [resolve(entry.codexHome), sourceIdentity(entry.source)]), searchTerm, searchMode, rolloutIndex.searchCandidateLimit]);
  if (cursor && cursor.scope !== scope) throw new DirectSessionsCandidateCursorError();
  const skipAppServer = searchMode === 'fast' || rolloutIndex.exactIdMatch;
  const appServerListing = skipAppServer
    ? { candidates: [] as DirectSessionCandidateV1[], incomplete: Boolean(searchTerm) && !rolloutIndex.exactIdMatch, coverage: [] as boolean[], excludedSessionIds: new Set<string>() }
    : await listCodexSessionCandidatesViaAppServerWithBudget({ homeEntries: rolloutIndex.homeEntries, titlesByHome: rolloutIndex.titlesByHome, env, searchTerm });
  const searchIncomplete = rolloutIndex.searchIncomplete || appServerListing.incomplete || rolloutIndex.homeEntries.length === 0;
  const excludedSessionIds = new Set([...rolloutIndex.excludedSessionIds, ...appServerListing.excludedSessionIds]);

  // 先确定整个轻量并集的胜出身份与顺序，再截页，避免按 offset 改变合并依据。
  type Entry = { remoteSessionId: string; updatedAtMs: number; source: unknown; readCandidate: () => Promise<DirectSessionCandidateV1> };
  const merged = new Map<string, Entry>();
  const appCandidates = new Map<string, DirectSessionCandidateV1>();
  const sourcesById = new Map<string, string>();
  const sourceConflicts = new Set<string>();
  const observeSource = (remoteSessionId: string, source: DirectSessionsSource): void => {
    const identity = fingerprint(sourceIdentity(source));
    const previous = sourcesById.get(remoteSessionId);
    if (previous !== undefined && previous !== identity) sourceConflicts.add(remoteSessionId);
    sourcesById.set(remoteSessionId, identity);
  };
  for (const candidate of appServerListing.candidates) {
    if (excludedSessionIds.has(candidate.remoteSessionId)) continue;
    observeSource(candidate.remoteSessionId, candidate.details!.source as DirectSessionsSource);
    appCandidates.set(candidate.remoteSessionId, candidate);
    merged.set(candidate.remoteSessionId, {
      remoteSessionId: candidate.remoteSessionId, updatedAtMs: candidate.updatedAtMs,
      source: sourceIdentity(candidate.details!.source as DirectSessionsSource), readCandidate: async () => ({
        ...candidate, details: { ...candidate.details, codexLifecycle: unknownCodexLifecycleV1(Date.now()) },
      }),
    });
  }
  for (const entry of rolloutIndex.entries) {
    if (excludedSessionIds.has(entry.remoteSessionId)) continue;
    observeSource(entry.remoteSessionId, entry.source);
    merged.set(entry.remoteSessionId, {
      remoteSessionId: entry.remoteSessionId, updatedAtMs: entry.updatedAtMs, source: sourceIdentity(entry.source),
      readCandidate: async () => mergeCodexDirectSessionCandidate({
        rolloutCandidate: await entry.readCandidate(), appServerCandidate: appCandidates.get(entry.remoteSessionId),
        indexedTitle: rolloutIndex.indexedTitles.get(entry.remoteSessionId),
      }),
    });
  }
  const ordered = Array.from(merged.values())
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.remoteSessionId.localeCompare(b.remoteSessionId));
  const order = fingerprint([ordered.map((entry) => [entry.remoteSessionId, entry.source]),
    skipAppServer, appServerListing.coverage, searchIncomplete]);
  const offset = cursor?.offset ?? 0;
  if (cursor && (cursor.order !== order || offset >= ordered.length)) throw new DirectSessionsCandidateCursorError();
  const candidates = await mapWithConcurrency(ordered.slice(offset, offset + limit), resolveRolloutSearchBuildConcurrency(env), async (entry) => {
    const candidate = await entry.readCandidate();
    // 合并前保留全部来源证据；最后胜出的同home不能掩盖先前已发现的冲突。
    return sourceConflicts.has(entry.remoteSessionId)
      ? { ...candidate, details: { ...candidate.details, codexLifecycle: unknownCodexLifecycleV1(Date.now()) } }
      : candidate;
  });
  const nextOffset = offset + candidates.length;
  const nextCursor = nextOffset < ordered.length
    ? Buffer.from(JSON.stringify({ v: 2, kind: 'index', offset: nextOffset, scope, order, searchMode } satisfies IndexCursorV2)).toString('base64url')
    : null;
  logger.debug('[directSessions.codex.candidates] list finished', {
    elapsedMs: Date.now() - startedAtMs, searchTermLength: searchTerm.length, searchMode,
    returnedCandidates: candidates.length, totalCount: ordered.length, searchIncomplete,
    rolloutTotalCount: rolloutIndex.entries.length, appServerCandidates: appServerListing.candidates.length,
    heapDeltaBytes: process.memoryUsage().heapUsed - startMemory.heapUsed, rssBytes: process.memoryUsage().rss,
  });
  return { candidates, nextCursor, ...(searchIncomplete ? { searchIncomplete: true } : {}) };
}
