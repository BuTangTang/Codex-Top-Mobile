import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { unknownCodexLifecycleV1, type DirectSessionCandidateV1 } from '@happier-dev/protocol';

import { DirectSessionsProviderUnavailableError } from '@/backends/directSessions/providerOps';

import { deriveDirectSessionActivityFromTimestamp } from '@/api/directSessions/activity/deriveDirectSessionActivityFromTimestamp';
import { mapWithConcurrency } from '@/api/directSessions/discovery/mapWithConcurrency';

import { isSubagentRollout, readCodexSessionMetaFromRollout, type CodexSessionMetaPayload } from '../localControl/rolloutDiscovery';
import { readCodexSessionIndexTitles } from './readCodexSessionIndexTitles';
import { readCodexSessionTitleFromRollout } from './readCodexSessionTitleFromRollout';
import type { CodexDirectSessionHomeEntry } from './resolveCodexHomeEntriesForDirectSessionsSource';
import { resolveCodexHomeEntriesForDirectSessionsSource } from './resolveCodexHomeEntriesForDirectSessionsSource';
import { readCodexCandidateLifecycle } from './readCodexCandidateLifecycle';

type RolloutCandidateGroup = Readonly<{
  lifecycleConflict: boolean;
  updatedAtMs: number;
  archived: boolean;
  latestFilePath: string;
  earliestFilePath: string;
  earliestMtimeMs: number;
  latestSortMs: number;
  earliestSortMs: number;
  latestMeta: CodexSessionMetaPayload | null;
  earliestMeta: CodexSessionMetaPayload | null;
}>;

/** 只扫描轻量文件索引；枚举失败向上报告，不能当作可信空来源。 */
async function collectRolloutFiles(params: Readonly<{
  rootDir: string;
  maxDepth: number;
  archived: boolean;
  filenameIncludes?: string;
}>): Promise<Array<{ filePath: string; mtimeMs: number; archived: boolean }>> {
  const out: Array<{ filePath: string; mtimeMs: number; archived: boolean }> = [];
  const maxDepth = Math.max(0, Math.trunc(params.maxDepth));
  const filenameIncludes = typeof params.filenameIncludes === 'string'
    ? params.filenameIncludes.trim().toLowerCase()
    : '';

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: any[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // 根目录尚未创建是合法空来源；扫描中消失或无法读取不能冒充空列表。
      if (depth === 0 && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new DirectSessionsProviderUnavailableError('codex_candidates_scan_unavailable');
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const name = typeof entry.name === 'string' ? entry.name : String(entry.name);
      const full = join(dir, name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      if (filenameIncludes && !name.toLowerCase().includes(filenameIncludes)) continue;
      try {
        const s = await stat(full);
        out.push({ filePath: full, mtimeMs: s.mtimeMs, archived: params.archived });
      } catch {
        throw new DirectSessionsProviderUnavailableError('codex_candidates_scan_unavailable');
      }
    }
  }

  await walk(params.rootDir, 0);
  return out;
}

function parseResumeIdFromRolloutFilename(filePath: string): string | null {
  const name = basename(filePath);
  const match = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/i.exec(name);
  return match ? match[1] : null;
}

function parseRolloutTimestampMs(filePath: string): number {
  const name = basename(filePath);
  const match = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-/i.exec(name);
  if (!match) return Number.NEGATIVE_INFINITY;
  const iso = `${match[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3')}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function parsePositiveIntEnv(params: Readonly<{
  env: NodeJS.ProcessEnv;
  key: string;
  defaultValue: number;
  min: number;
  max: number;
}>): number {
  const raw = Number.parseInt(String(params.env[params.key] ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : params.defaultValue;
  return Math.max(params.min, Math.min(params.max, configured));
}

function resolveRolloutSearchCandidateLimit(params: Readonly<{ env: NodeJS.ProcessEnv; searchMode?: 'fast' | 'full' }>): number {
  if (params.searchMode === 'fast') {
    return parsePositiveIntEnv({
      env: params.env,
      key: 'HAPPIER_CODEX_DIRECT_SESSIONS_FAST_SEARCH_CANDIDATE_LIMIT',
      defaultValue: 200,
      min: 1,
      max: 5000,
    });
  }
  return parsePositiveIntEnv({
    env: params.env,
    key: 'HAPPIER_CODEX_DIRECT_SESSIONS_FULL_SEARCH_CANDIDATE_LIMIT',
    defaultValue: 1000,
    min: 1,
    max: 25_000,
  });
}

/** 延续既有详情读取并发上限，索引合并不能扩大文件读取预算。 */
export function resolveRolloutSearchBuildConcurrency(env: NodeJS.ProcessEnv): number {
  return parsePositiveIntEnv({
    env,
    key: 'HAPPIER_CODEX_DIRECT_SESSIONS_SEARCH_BUILD_CONCURRENCY',
    defaultValue: 8,
    min: 1,
    max: 64,
  });
}

function canSearchRolloutFilename(searchTerm: string): boolean {
  return searchTerm.length >= 4 && /^[a-z0-9._:-]+$/i.test(searchTerm);
}

/** 复用索引阶段读取的来源元数据，只为实际需要的候选读取标题正文。 */
async function buildRolloutCandidate(params: Readonly<{
  remoteSessionId: string;
  group: RolloutCandidateGroup;
  indexedTitle?: string;
  env: NodeJS.ProcessEnv;
  source: CodexDirectSessionHomeEntry['source'];
}>): Promise<DirectSessionCandidateV1> {
  const { latestMeta, earliestMeta } = params.group;
  const title = params.indexedTitle ?? await readCodexSessionTitleFromRollout(params.group.earliestFilePath);
  const cwd = latestMeta && typeof latestMeta.cwd === 'string' ? latestMeta.cwd : undefined;
  const createdAtMs = (() => {
    const ts = earliestMeta && typeof earliestMeta.timestamp === 'string' ? Date.parse(earliestMeta.timestamp) : NaN;
    if (Number.isFinite(ts) && ts >= 0) return Math.trunc(ts);
    return Math.trunc(params.group.earliestMtimeMs);
  })();

  return {
    remoteSessionId: params.remoteSessionId,
    ...(title ? { title } : {}),
    createdAtMs,
    updatedAtMs: Math.trunc(params.group.updatedAtMs),
    archived: params.group.archived,
    activity: deriveDirectSessionActivityFromTimestamp({ updatedAtMs: params.group.updatedAtMs, env: params.env }),
    details: {
      ...(cwd ? { cwd } : {}),
      source: params.source,
      codexLifecycle: params.group.lifecycleConflict
        ? unknownCodexLifecycleV1(Date.now())
        : await readCodexCandidateLifecycle({ filePath: params.group.latestFilePath, remoteSessionId: params.remoteSessionId }),
    },
  };
}

/** 解析实际 homes 并按首条来源元数据排除内部代理，正文搜索仍遵守候选预算。 */
export async function indexCodexDirectSessionCandidatesViaRollouts(params: Readonly<{
  source: CodexDirectSessionHomeEntry['source'];
  activeServerDir: string;
  env?: NodeJS.ProcessEnv;
  searchTerm?: string;
  searchMode?: 'fast' | 'full';
}>): Promise<Readonly<{
  entries: ReadonlyArray<Readonly<{
    remoteSessionId: string;
    updatedAtMs: number;
    source: CodexDirectSessionHomeEntry['source'];
    readCandidate: () => Promise<DirectSessionCandidateV1>;
  }>>;
  homeEntries: CodexDirectSessionHomeEntry[];
  indexedTitles: ReadonlyMap<string, string>;
  titlesByHome: ReadonlyMap<string, ReadonlyMap<string, string>>;
  excludedSessionIds: ReadonlySet<string>;
  searchIncomplete: boolean;
  searchCandidateLimit: number | null;
  exactIdMatch: boolean;
}>> {
  const env = params.env ?? process.env;
  const homeEntries = await resolveCodexHomeEntriesForDirectSessionsSource({
    source: params.source,
    activeServerDir: params.activeServerDir,
    env,
    strictEnumeration: true,
  }).catch(() => {
    throw new DirectSessionsProviderUnavailableError('codex_candidates_home_scan_unavailable');
  });
  const searchTerm = typeof params.searchTerm === 'string' ? params.searchTerm.trim().toLowerCase() : '';
  homeEntries.sort((a, b) => a.codexHome.localeCompare(b.codexHome));
  // 请求内每个实际 home 只读一次；不跨请求缓存，也不把其他 home 的标题借给当前来源。
  const titlesByHome = new Map<string, ReadonlyMap<string, string>>();
  for (const homeEntry of homeEntries) {
    if (!titlesByHome.has(homeEntry.codexHome)) titlesByHome.set(homeEntry.codexHome, await readCodexSessionIndexTitles(homeEntry.codexHome));
  }
  const indexedTitles = new Map<string, string>();
  const excludedSessionIds = new Set<string>();
  const metadataByPath = new Map<string, CodexSessionMetaPayload | null>();

  /** 在分页和搜索预算截断前按来源过滤；同一身份的任一明确子代理记录都不能重新进入并集。 */
  async function collectGroupedCandidates(filenameIncludes?: string): Promise<Array<{
    remoteSessionId: string;
    entry: { group: RolloutCandidateGroup; source: CodexDirectSessionHomeEntry['source']; codexHome: string };
  }>> {
    const grouped = new Map<string, { group: RolloutCandidateGroup; source: CodexDirectSessionHomeEntry['source']; codexHome: string }>();
    for (const homeEntry of homeEntries) {
      const files = [
        ...(await collectRolloutFiles({ rootDir: join(homeEntry.codexHome, 'sessions'), maxDepth: 10, archived: false, filenameIncludes })),
        ...(await collectRolloutFiles({ rootDir: join(homeEntry.codexHome, 'archived_sessions'), maxDepth: 10, archived: true, filenameIncludes })),
      ];
      // 请求内只保留候选所需字段，不滞留 session_meta 中的整段注入指令。
      await mapWithConcurrency(files, resolveRolloutSearchBuildConcurrency(env), async ({ filePath }) => {
        if (metadataByPath.has(filePath)) return;
        const meta = await readCodexSessionMetaFromRollout(filePath);
        metadataByPath.set(filePath, meta ? {
          id: meta.id, timestamp: meta.timestamp, cwd: meta.cwd, source: meta.source, thread_source: meta.thread_source,
        } : null);
      });
      for (const entry of files) {
        const resumeId = parseResumeIdFromRolloutFilename(entry.filePath);
        if (!resumeId) continue;
        const meta = metadataByPath.get(entry.filePath) ?? null;
        if (meta && isSubagentRollout(meta)) excludedSessionIds.add(resumeId);
        if (excludedSessionIds.has(resumeId)) continue;
        const existing = grouped.get(resumeId);
        const entrySortMs = parseRolloutTimestampMs(entry.filePath);
        if (!existing) {
          grouped.set(resumeId, {
            source: homeEntry.source,
            codexHome: homeEntry.codexHome,
            group: {
              lifecycleConflict: false,
              updatedAtMs: entry.mtimeMs,
              archived: entry.archived,
              latestFilePath: entry.filePath,
              earliestFilePath: entry.filePath,
              earliestMtimeMs: entry.mtimeMs,
              latestSortMs: entrySortMs,
              earliestSortMs: entrySortMs,
              latestMeta: meta,
              earliestMeta: meta,
            },
          });
          continue;
        }
        grouped.set(resumeId, {
          source: entrySortMs >= existing.group.latestSortMs ? homeEntry.source : existing.source,
          codexHome: entrySortMs >= existing.group.latestSortMs ? homeEntry.codexHome : existing.codexHome,
          group: {
            // 同身份多文件/多home不能按文件名或mtime选择生命周期胜者。
            lifecycleConflict: true,
            updatedAtMs: Math.max(existing.group.updatedAtMs, entry.mtimeMs),
            archived: existing.group.archived && entry.archived,
            latestFilePath: entrySortMs >= existing.group.latestSortMs ? entry.filePath : existing.group.latestFilePath,
            earliestFilePath: entrySortMs <= existing.group.earliestSortMs ? entry.filePath : existing.group.earliestFilePath,
            earliestMtimeMs: Math.min(existing.group.earliestMtimeMs, entry.mtimeMs),
            latestSortMs: Math.max(existing.group.latestSortMs, entrySortMs),
            earliestSortMs: Math.min(existing.group.earliestSortMs, entrySortMs),
            latestMeta: entrySortMs >= existing.group.latestSortMs ? meta : existing.group.latestMeta,
            earliestMeta: entrySortMs <= existing.group.earliestSortMs ? meta : existing.group.earliestMeta,
          },
        });
      }
    }

    indexedTitles.clear();
    for (const id of excludedSessionIds) grouped.delete(id);
    for (const [id, entry] of grouped) {
      const title = titlesByHome.get(entry.codexHome)?.get(id);
      if (title) indexedTitles.set(id, title);
    }
    return Array.from(grouped.entries())
      .map(([remoteSessionId, entry]) => ({ remoteSessionId, entry }))
      .sort((a, b) => Math.trunc(b.entry.group.updatedAtMs) - Math.trunc(a.entry.group.updatedAtMs) || String(a.remoteSessionId).localeCompare(String(b.remoteSessionId)));
  }

  async function buildCandidates(entries: ReadonlyArray<{
    remoteSessionId: string;
    entry: { group: RolloutCandidateGroup; source: CodexDirectSessionHomeEntry['source']; codexHome: string };
  }>): Promise<DirectSessionCandidateV1[]> {
    return mapWithConcurrency(entries, resolveRolloutSearchBuildConcurrency(env), ({ remoteSessionId, entry }) =>
      buildRolloutCandidate({ remoteSessionId, group: entry.group, env, source: entry.source, indexedTitle: indexedTitles.get(remoteSessionId) }),
    );
  }

  // 索引涵盖本次观察到的全部身份，详情读取延迟到最终合并分页之后。
  /** 保留排序与来源身份，仅在页面最终选中后打开会话详情。 */
  function lazyEntries(entries: Awaited<ReturnType<typeof collectGroupedCandidates>>) {
    return entries.map(({ remoteSessionId, entry }) => ({
      remoteSessionId,
      updatedAtMs: Math.trunc(entry.group.updatedAtMs),
      source: entry.source,
      readCandidate: () => buildRolloutCandidate({ remoteSessionId, group: entry.group, env, source: entry.source, indexedTitle: indexedTitles.get(remoteSessionId) }),
    }));
  }
  const searchCandidateLimit = searchTerm ? resolveRolloutSearchCandidateLimit({ env, searchMode: params.searchMode }) : null;
  if (searchTerm && canSearchRolloutFilename(searchTerm)) {
    const filenameMatches = await collectGroupedCandidates(searchTerm);
    if (filenameMatches.length > 0) {
      const exactIdMatch = filenameMatches.some(({ remoteSessionId }) => remoteSessionId.toLowerCase() === searchTerm);
      return {
        entries: lazyEntries(filenameMatches), homeEntries, indexedTitles, titlesByHome, excludedSessionIds, searchCandidateLimit, exactIdMatch,
        searchIncomplete: params.searchMode === 'fast' && !exactIdMatch,
      };
    }
    if (params.searchMode === 'fast') {
      return { entries: [], homeEntries, indexedTitles, titlesByHome, excludedSessionIds, searchCandidateLimit, exactIdMatch: false, searchIncomplete: true };
    }
  }

  const groupedCandidates = await collectGroupedCandidates();
  if (!searchTerm) {
    return { entries: lazyEntries(groupedCandidates), homeEntries, indexedTitles, titlesByHome, excludedSessionIds, searchCandidateLimit, exactIdMatch: false, searchIncomplete: false };
  }

  // 标题正文搜索仍遵守既有候选预算，不把来源头扫描扩大成整表正文扫描。
  const entriesToSearch = groupedCandidates.slice(0, searchCandidateLimit!);
  const allCandidates = await buildCandidates(entriesToSearch);
  const filtered = allCandidates.filter((candidate) => {
    const cwd = candidate.details?.cwd;
    const title = candidate.title;
    const haystack = `${candidate.remoteSessionId}${title ? ` ${title}` : ''}${cwd ? ` ${cwd}` : ''}`.toLowerCase();
    return haystack.includes(searchTerm);
  });
  return {
    entries: filtered.map((candidate) => ({
      remoteSessionId: candidate.remoteSessionId,
      updatedAtMs: candidate.updatedAtMs,
      source: candidate.details!.source as CodexDirectSessionHomeEntry['source'],
      readCandidate: async () => candidate,
    })),
    homeEntries, indexedTitles, titlesByHome, excludedSessionIds, searchCandidateLimit, exactIdMatch: false,
    searchIncomplete: entriesToSearch.length < groupedCandidates.length,
  };
}
