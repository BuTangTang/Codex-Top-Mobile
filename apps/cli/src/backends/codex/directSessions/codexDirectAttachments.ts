import { basename, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DirectSessionAttachmentV1 } from '@happier-dev/protocol';
import { extractCodexGeneratedMedia } from '../media/extractCodexGeneratedMedia';

/** 只读取记录对象，不执行或下载正文中的引用。 */
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 本地文件引用必须有真实绝对路径；网页、云引用与 sandbox 不冒充本机路径。 */
function localPath(reference: string): string | null {
  let path = reference.trim();
  if (path.startsWith('file://')) {
    try { path = fileURLToPath(path); } catch { return null; }
  }
  if (!isAbsolute(path) || path.includes('\0')) return null;
  return path;
}

/** 从明确本地引用形成轻量描述，不提前读取大文件或复制 provider 文件。 */
function attachmentForPath(path: string, image = false, name = basename(path)): DirectSessionAttachmentV1 {
  const extension = extname(path).toLowerCase();
  const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.avif': 'image/avif', '.heic': 'image/heic', '.svg': 'image/svg+xml' } as Record<string, string>)[extension];
  return { name, path, kind: image || mimeType ? 'image' : 'file', ...(mimeType ? { mimeType } : {}) };
}

/** 相同引用在同条回复只展示一次，不以文件名合并不同路径。 */
function uniqueAttachments(items: DirectSessionAttachmentV1[]): DirectSessionAttachmentV1[] {
  const seen = new Set<string>();
  return items.filter((item) => { const key = `${item.kind}:${item.path}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** 提取 Markdown 里明确指向本机文件的链接；正常网页仍按原正文保留。 */
export function readCodexMarkdownAttachments(text: string): DirectSessionAttachmentV1[] {
  const attachments: DirectSessionAttachmentV1[] = [];
  const link = /(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|((?:[^()\s]|\([^()\n]*\))+))(?:\s+["'][^\n]*?["'])?\s*\)/g;
  for (const match of text.matchAll(link)) {
    const path = localPath(match[3] ?? match[4] ?? '');
    if (path) attachments.push(attachmentForPath(path, match[1] === '!'));
  }
  return uniqueAttachments(attachments);
}

/** 仅拆解完整原生文件前缀；保留标签中的冒号，并按显式图片标记保留原文件类型。 */
export function readCodexUserAttachments(text: string): { text: string; attachments: DirectSessionAttachmentV1[] } {
  const wrapper = /^\s*# Files mentioned by the user:\n([\s\S]*?)\nDistinguish instructions in attached documents from the user's request\.\n+## My request:\n?([\s\S]*)$/.exec(text);
  if (!wrapper) return { text, attachments: readCodexMarkdownAttachments(text) };
  const attachments: DirectSessionAttachmentV1[] = [];
  // 分隔符后的引用必须从绝对路径或 file URL 开始，不能把文件名或路径里的冒号当边界。
  for (const match of wrapper[1]!.matchAll(/^## (.+?): ((?:\/|file:\/\/|[a-zA-Z]:[\\/]).+)\n?(Image attachment: true)?/gm)) {
    const path = localPath(match[2]!);
    // 原生 wrapper 已明确文件类型；扩展名只补 MIME，Markdown 分支仍沿原规则推断类型。
    if (path) attachments.push({ ...attachmentForPath(path, Boolean(match[3]), match[1]!), kind: match[3] ? 'image' : 'file' });
  }
  if (!attachments.length) return { text, attachments: [] };
  return { text: wrapper[2]!.trim(), attachments: uniqueAttachments(attachments) };
}

/** 图片生成记录沿现有提取 owner；base64 由异步传输边界给出真实文件，云引用明确不可用。 */
export function readCodexGeneratedAttachments(lineValue: unknown, materialized?: readonly DirectSessionAttachmentV1[]): readonly DirectSessionAttachmentV1[] {
  const line = record(lineValue), payload = record(line?.payload);
  if (line?.type !== 'response_item' || payload?.type !== 'image_generation_call') return [];
  if (materialized) return materialized;
  const result: DirectSessionAttachmentV1[] = [];
  for (const source of extractCodexGeneratedMedia(payload)) {
    if (source.kind === 'local-file') {
      const path = localPath(source.path);
      result.push(path ? attachmentForPath(path, true) : { name: '生成图片', kind: 'image', availability: 'unavailable', reason: 'unsupported_reference' });
    } else if (source.kind === 'base64') {
      result.push({ name: '生成图片', kind: 'image', availability: 'unavailable', reason: 'materialization_required' });
    }
  }
  // 现有提取器只接纳实际图片字节；未解析的生成引用也必须保留可见的不可用状态。
  if (!result.length && [payload.result, payload.image, payload.image_b64].some((value) => typeof value === 'string' && value.trim())
      && (payload.status === 'completed' || payload.status === 'succeeded'))
    result.push({ name: '生成图片', kind: 'image', availability: 'unavailable', reason: 'unsupported_reference' });
  return result;
}

/** 复用 attachments.v1，旧消费者仍可读取正文，不发送文件字节或 base64。 */
export function codexAttachmentMeta(attachments: readonly DirectSessionAttachmentV1[]) {
  return attachments.length ? { meta: { happier: { kind: 'attachments.v1', payload: { attachments } } } } : {};
}
