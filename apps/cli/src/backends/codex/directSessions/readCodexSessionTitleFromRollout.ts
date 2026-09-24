import { readJsonlFileForward } from '@/api/directSessions/filePaging/jsonlForwardReader';
import { readDirectSessionTitleCandidate } from '@/api/directSessions/title/readDirectSessionTitleCandidate';

import { mapCodexRolloutEventToActions } from '../localControl/rolloutMapper';
import { readCodexMessageContentText } from '../utils/readCodexMessageContentText';
import { readCodexPreviewTitle, stripCodexInjectedTitleBlocks } from './readCodexPreviewTitle';

const TITLE_SCAN_CHUNK_MAX_BYTES = 128 * 1024;
const TITLE_SCAN_CHUNK_MAX_ITEMS = 64;
const TITLE_SCAN_TOTAL_MAX_BYTES = 1024 * 1024;
const TITLE_SCAN_TOTAL_MAX_ITEMS = 512;

function readTitleFromToolInput(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const title = typeof (input as Record<string, unknown>).title === 'string'
    ? String((input as Record<string, unknown>).title)
    : '';
  return readDirectSessionTitleCandidate(title);
}

/** 仅在标题提取时清理消息副本，避免宿主过滤器丢掉与注入块共存的真实用户请求。 */
function cleanTitleEvent(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const event = value as Record<string, unknown>;
  const payload = event.payload;
  if (event.type !== 'response_item' || !payload || typeof payload !== 'object' || Array.isArray(payload)) return value;
  const item = payload as Record<string, unknown>;
  if (item.type !== 'message') return value;
  const text = readCodexMessageContentText(item.content);
  return text === null ? value : { ...event, payload: { ...item, content: stripCodexInjectedTitleBlocks(text) } };
}

/** 保留原有扫描预算与标题顺序，正文回退先剥离已知宿主注入块。 */
export async function readCodexSessionTitleFromRollout(filePath: string): Promise<string | null> {
  let fallbackAssistantText: string | null = null;
  let offsetBytes = 0;
  let scannedBytes = 0;
  let scannedItems = 0;

  while (scannedBytes < TITLE_SCAN_TOTAL_MAX_BYTES && scannedItems < TITLE_SCAN_TOTAL_MAX_ITEMS) {
    const page = await readJsonlFileForward({
      filePath,
      offsetBytes,
      maxBytes: Math.min(TITLE_SCAN_CHUNK_MAX_BYTES, TITLE_SCAN_TOTAL_MAX_BYTES - scannedBytes),
      maxItems: Math.min(TITLE_SCAN_CHUNK_MAX_ITEMS, TITLE_SCAN_TOTAL_MAX_ITEMS - scannedItems),
    });

    for (const line of page.items) {
      const actions = mapCodexRolloutEventToActions(cleanTitleEvent(line.value), { debug: false });
      for (const action of actions) {
        if (action.type === 'tool-call' && action.name === 'change_title') {
          const fromTool = readTitleFromToolInput(action.input);
          if (fromTool) return fromTool;
        }
        if (action.type === 'user-text') {
          const title = readCodexPreviewTitle(action.text);
          if (title) return title;
        }
        if (action.type === 'assistant-text' && fallbackAssistantText === null) {
          fallbackAssistantText = readCodexPreviewTitle(action.text);
        }
      }
    }

    if (page.reachedEnd || page.nextOffsetBytes <= offsetBytes) break;
    scannedBytes += Math.max(0, page.nextOffsetBytes - offsetBytes);
    scannedItems += page.items.length;
    offsetBytes = page.nextOffsetBytes;
  }

  return fallbackAssistantText;
}
