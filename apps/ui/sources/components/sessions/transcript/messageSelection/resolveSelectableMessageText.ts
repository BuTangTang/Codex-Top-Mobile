import { normalizeVoiceAgentTurnTranscriptText } from '@happier-dev/agents';

import { parseHappierMetaEnvelope } from '@/components/sessions/transcript/structured/happierMetaEnvelope';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { readStreamSegmentMetaV1 } from '@/sync/reducer/helpers/streamSegmentMeta';

import type { TranscriptSelectableMessageText } from './_types';

export function stripLegacyAttachmentsBlock(text: string): string {
    const startTag = '[attachments]';
    const endTag = '[/attachments]';
    const start = text.indexOf(startTag);
    const end = text.indexOf(endTag);
    if (start < 0 || end < 0 || end <= start) return text;

    let stripStart = start;
    const intro = text.lastIndexOf('Attachments:', start);
    if (intro >= 0) {
        const lineStart = text.lastIndexOf('\n', intro - 1) + 1;
        if (lineStart === intro || text.slice(lineStart, intro).trim() === '') {
            stripStart = lineStart;
        }
    }

    const before = text.slice(0, stripStart).trimEnd();
    const after = text.slice(end + endTag.length).trimStart();
    if (!before) return after;
    if (!after) return before;
    return `${before}\n\n${after}`;
}

export function unwrapLegacyThinkingWrapper(text: string): string {
    const match = text.match(/^\*Thinking\.\.\.\*\n\n\*([\s\S]*)\*$/);
    return match ? match[1] : text;
}

/** 仅供助手显示与复制使用：隐藏内部记忆引用，原始消息与代码示例保持不变。 */
export function stripInternalMemoryCitations(text: string): string {
    if (!text.includes('<oai-')) return text;
    const startTag = '<oai-mem-citation>';
    const endTag = '</oai-mem-citation>';
    let fence: { marker: string; length: number } | null = null;
    let cursor = 0;
    let copyFrom = 0;
    const visible: string[] = [];

    while (cursor < text.length) {
        if (cursor === 0 || text[cursor - 1] === '\n') {
            const newline = text.indexOf('\n', cursor);
            const lineEnd = newline < 0 ? text.length : newline + 1;
            const line = text.slice(cursor, lineEnd);
            // 引用或列表里的围栏同样是代码；只移除容器前缀，保留代码缩进。
            const codeLine = line.replace(/^(?: {0,3}>[ \t]?)+/, '').replace(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]/, '');
            const marker = codeLine.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
            // 围栏按字符和长度配对；未闭合围栏与缩进代码也不能被当作内部引用。
            if (fence) {
                if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) {
                    fence = null;
                }
                cursor = lineEnd;
                continue;
            }
            if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
                fence = { marker: marker[1][0], length: marker[1].length };
                cursor = lineEnd;
                continue;
            }
            if (/^( {4}|\t)/.test(codeLine)) {
                cursor = lineEnd;
                continue;
            }
        }
        // 行内代码可包含同名标签；只跳过有对应结束反引号的代码段。
        if (text[cursor] === '`') {
            const delimiter = text.slice(cursor).match(/^`+/)![0];
            let end = text.indexOf(delimiter, cursor + delimiter.length);
            while (end >= 0 && (text[end - 1] === '`' || text[end + delimiter.length] === '`')) {
                end = text.indexOf(delimiter, end + delimiter.length);
            }
            cursor = end < 0 ? cursor + delimiter.length : end + delimiter.length;
            continue;
        }
        if (text[cursor] === '<') {
            let escapeStart = cursor;
            while (escapeStart > 0 && text[escapeStart - 1] === '\\') escapeStart -= 1;
            const escaped = (cursor - escapeStart) % 2 === 1;
            if (!escaped && text.startsWith(startTag, cursor)) {
                visible.push(text.slice(copyFrom, cursor));
                const end = text.indexOf(endTag, cursor + startTag.length);
                cursor = end < 0 ? text.length : end + endTag.length;
                copyFrom = cursor;
                continue;
            }
            // 流式开头已明确属于内部标签时即隐藏，避免尚未接收完整标签时闪现。
            if (!escaped && text.startsWith('<oai-', cursor) && startTag.startsWith(text.slice(cursor).trimEnd())) {
                visible.push(text.slice(copyFrom, cursor));
                copyFrom = text.length;
                break;
            }
        }
        cursor += 1;
    }
    if (copyFrom === 0) return text;
    visible.push(text.slice(copyFrom));
    return visible.join('').trimEnd();
}

function isVoiceAgentTurn(message: Message): boolean {
    if (message.kind !== 'user-text' && message.kind !== 'agent-text') return false;
    return parseHappierMetaEnvelope(message.meta)?.kind === 'voice_agent_turn.v1';
}

export function isAgentTextMessageActivelyStreamingForSelection(message: Message): boolean {
    if (message.kind !== 'agent-text') return false;
    const streamSegmentMeta = readStreamSegmentMetaV1(message.meta);
    if (!streamSegmentMeta) return false;
    if (streamSegmentMeta.segmentState === 'streaming') return true;
    return streamSegmentMeta.segmentKind === 'assistant' && streamSegmentMeta.segmentState === null;
}

function normalizeResolvedText(entry: TranscriptSelectableMessageText): TranscriptSelectableMessageText | null {
    if (!entry.text.trim()) return null;
    return entry;
}

/** 统一选择与复制正文，助手引用清理不进入用户消息或存储层。 */
export function resolveSelectableMessageText(input: {
    message: Message;
    isStructuredOnly: boolean;
    hasAttachmentBlockToStrip: boolean;
}): TranscriptSelectableMessageText | null {
    const { message } = input;

    if (message.kind === 'user-text') {
        const text = input.isStructuredOnly
            ? message.text
            : isVoiceAgentTurn(message) && message.displayText === undefined
                ? normalizeVoiceAgentTurnTranscriptText(message.text)
                : message.displayText !== undefined
                    ? message.displayText
                    : input.hasAttachmentBlockToStrip
                        ? stripLegacyAttachmentsBlock(message.text)
                        : message.text;
        if (text == null) return null;
        return normalizeResolvedText({ role: 'user', text });
    }

    if (message.kind === 'agent-text') {
        if (isAgentTextMessageActivelyStreamingForSelection(message)) return null;
        const baseText = input.isStructuredOnly
            ? message.text
            : isVoiceAgentTurn(message)
                ? normalizeVoiceAgentTurnTranscriptText(message.text)
                : message.text;
        if (baseText == null) return null;
        const text = input.isStructuredOnly ? baseText : stripInternalMemoryCitations(
            message.isThinking ? unwrapLegacyThinkingWrapper(baseText) : baseText,
        );
        return normalizeResolvedText({ role: 'assistant', text });
    }

    return null;
}
