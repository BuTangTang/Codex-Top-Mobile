import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { readJsonlFileForward } from '@/api/directSessions/filePaging/jsonlForwardReader';

// 列表元数据只读预算；不能读完则全 home 回退，避免把旧前缀当作最新标题。
const MAX_INDEX_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 每次请求按实际 home 读取完整索引；失败只失去标题增强，不改变候选可用性。 */
export async function readCodexSessionIndexTitles(codexHome: string): Promise<ReadonlyMap<string, string>> {
  const filePath = join(codexHome, 'session_index.jsonl');
  try {
    const before = await stat(filePath);
    if (!before.isFile() || before.size <= 0 || before.size > MAX_INDEX_BYTES) return new Map();
    const page = await readJsonlFileForward({
      filePath, offsetBytes: 0, maxBytes: before.size, maxItems: before.size,
      maxOversizeLineBytes: before.size, strictRead: true,
    });
    const after = await stat(filePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino
      || !page.reachedEnd || page.nextOffsetBytes !== before.size
      // 通用 reader 兼容无换行 JSON；索引必须只接受已提交的完整行。
      || page.items.some((line) => line.endOffsetBytes >= before.size)) return new Map();
    const latest = new Map<string, { time: number; title: string; conflict: boolean }>();
    for (const line of page.items) {
      const value = line.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)
        || typeof row.thread_name !== 'string' || !row.thread_name.trim()
        || typeof row.updated_at !== 'string') continue;
      const time = Date.parse(row.updated_at);
      if (!Number.isFinite(time) || time < 0) continue;
      const title = row.thread_name.trim();
      const previous = latest.get(row.id);
      if (!previous || time > previous.time) latest.set(row.id, { time, title, conflict: false });
      else if (time === previous.time && title !== previous.title) previous.conflict = true;
    }
    return new Map(Array.from(latest.entries()).flatMap(([id, value]) => value.conflict ? [] : [[id, value.title]]));
  } catch {
    // 缺失、权限与并发文件变化均保留原来的 app-server / rollout 标题路径。
    return new Map();
  }
}
