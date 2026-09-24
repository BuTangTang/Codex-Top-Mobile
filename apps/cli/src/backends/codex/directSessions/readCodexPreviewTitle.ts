import { readDirectSessionTitleCandidate } from '@/api/directSessions/title/readDirectSessionTitleCandidate';

// 仅列出宿主注入标记；普通正文及用户自行命名的正式标题不经过此清理。
const INJECTED_TAGS = 'codex_internal_context|in-app-browser-context|environment_context|instructions|subagent_notification|turn_aborted|app-context|collaboration_mode|multi_agent_role|skills_instructions';

/** 按完整已知标签名和嵌套边界移除注入块；保留普通后缀标签，未闭合注入块的余文不作标题。 */
export function stripCodexInjectedTitleBlocks(text: string): string {
  const tags = new RegExp(`<(/?)(${INJECTED_TAGS})(?=[\\t\\r\\n ]|/?>|$)(?:[^>]*>|$)`, 'gi');
  const stack: string[] = [];
  const visible: string[] = [];
  let offset = 0;
  for (const match of text.matchAll(tags)) {
    if (stack.length === 0) visible.push(text.slice(offset, match.index));
    const name = match[2]!.toLowerCase();
    if (match[1]) {
      const openIndex = stack.lastIndexOf(name);
      if (openIndex >= 0) stack.splice(openIndex);
    } else if (!match[0].endsWith('/>')) {
      stack.push(name);
    }
    offset = match.index! + match[0].length;
  }
  if (stack.length === 0) visible.push(text.slice(offset));
  return visible.join('\n').trim();
}

/** 为 rollout 正文和 App Server preview 共用同一标题清理与摘要规则。 */
export function readCodexPreviewTitle(value: string): string | null {
  return readDirectSessionTitleCandidate(stripCodexInjectedTitleBlocks(value));
}
