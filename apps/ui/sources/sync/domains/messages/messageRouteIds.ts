import type { Message } from './messageTypes';
import type { ReducerState } from '@/sync/reducer/reducer';

type RouteLookupState = Pick<ReducerState, 'toolIdToMessageId' | 'sidechainToolIdToMessageId' | 'messageIds' | 'localIds'>;

function normalizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function readNonBlankOpaqueString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export type StableSessionMessageRouteRef = Readonly<{
    kind: 'tool' | 'server' | 'local';
    value: string;
}>;

export function parseStableSessionMessageRouteId(routeMessageId: string | null | undefined): StableSessionMessageRouteRef | null {
    if (typeof routeMessageId === 'string' && routeMessageId.startsWith('local:')) {
        const value = readNonBlankOpaqueString(routeMessageId.slice('local:'.length));
        return value ? { kind: 'local', value } : null;
    }
    const normalizedRouteMessageId = normalizeNonEmptyString(routeMessageId);
    if (!normalizedRouteMessageId) return null;
    return parseStableRouteRef(normalizedRouteMessageId);
}

function parseStableRouteRef(routeMessageId: string): StableSessionMessageRouteRef | null {
    if (routeMessageId.startsWith('tool:')) {
        const value = normalizeNonEmptyString(routeMessageId.slice('tool:'.length));
        return value ? { kind: 'tool', value } : null;
    }
    if (routeMessageId.startsWith('server:')) {
        const value = normalizeNonEmptyString(routeMessageId.slice('server:'.length));
        return value ? { kind: 'server', value } : null;
    }
    return null;
}

export function isStableSessionMessageRouteId(routeMessageId: string | null | undefined): boolean {
    return parseStableSessionMessageRouteId(routeMessageId) !== null;
}

function readStableServerMessageId(message: Message): string | null {
    const maybeRealId = (message as Message & { realID?: unknown }).realID;
    return normalizeNonEmptyString(maybeRealId);
}

function readStableLocalMessageId(message: Message): string | null {
    return 'localId' in message ? readNonBlankOpaqueString(message.localId) : null;
}

function findOriginalMessageIdForInternalId(reducerState: RouteLookupState | null | undefined, internalMessageId: string): string | null {
    if (!reducerState?.messageIds) return null;
    for (const [originalId, mappedInternalId] of reducerState.messageIds.entries()) {
        if (mappedInternalId === internalMessageId) {
            return normalizeNonEmptyString(originalId);
        }
    }
    return null;
}

export function buildToolCallMessageRouteId(params: Readonly<{
    toolId?: string | null;
    fallbackMessageId?: string | null;
}>): string | null {
    if (typeof params.fallbackMessageId === 'string') {
        const stableFallbackRef = parseStableSessionMessageRouteId(params.fallbackMessageId);
        if (stableFallbackRef?.kind === 'local') return `local:${stableFallbackRef.value}`;
    }
    const stableFallbackMessageId = normalizeNonEmptyString(params.fallbackMessageId);
    if (isStableSessionMessageRouteId(stableFallbackMessageId)) {
        return stableFallbackMessageId;
    }
    const toolId = normalizeNonEmptyString(params.toolId);
    if (toolId) return `tool:${toolId}`;
    return stableFallbackMessageId;
}

export function buildMessageRouteId(message: Message): string {
    const stableServerMessageId = readStableServerMessageId(message);
    const stableLocalMessageId = readStableLocalMessageId(message);
    if (message.kind === 'tool-call') {
        return buildToolCallMessageRouteId({
            toolId: typeof message.tool.id === 'string' ? message.tool.id : null,
            fallbackMessageId:
                stableServerMessageId
                    ? `server:${stableServerMessageId}`
                    : stableLocalMessageId
                        ? `local:${stableLocalMessageId}`
                        : message.id,
        }) ?? (stableServerMessageId ? `server:${stableServerMessageId}` : stableLocalMessageId ? `local:${stableLocalMessageId}` : message.id);
    }
    return stableServerMessageId ? `server:${stableServerMessageId}` : stableLocalMessageId ? `local:${stableLocalMessageId}` : message.id;
}

type SessionMessageRouteInput = Readonly<{
    messageId: string;
    messagesById: Readonly<Record<string, Message>>;
}>;

/** 单条与批量入口共用原始 ID 优先级及消息降级规则。 */
function buildSessionMessageRouteIdFromOriginal(
    messageId: string,
    message: Message | undefined,
    originalMessageId: string | null,
): string {
    if (originalMessageId) return `server:${originalMessageId}`;
    return message ? buildMessageRouteId(message) : messageId;
}

/** 单条查询读取当前 reducer 映射，再沿原规则生成稳定路由。 */
export function buildSessionMessageRouteId(params: SessionMessageRouteInput & Readonly<{
    reducerState: RouteLookupState | null | undefined;
}>): string | null {
    const messageId = normalizeNonEmptyString(params.messageId);
    if (!messageId) return null;

    const message = params.messagesById[messageId];
    const originalMessageId = findOriginalMessageIdForInternalId(params.reducerState, messageId);
    return buildSessionMessageRouteIdFromOriginal(messageId, message, originalMessageId);
}

/** 仅供一次同步派生批次使用；重建时读取当前映射，不跨批次缓存。 */
export function createSessionMessageRouteIdResolver(
    reducerState: RouteLookupState | null | undefined,
): (params: SessionMessageRouteInput) => string | null {
    const originalIdsByInternalId = new Map<string, string | null>();
    for (const [originalId, internalId] of reducerState?.messageIds?.entries() ?? []) {
        // 首个空白原始 ID 也占位，保留单条查询不会继续寻找后续 alias 的语义。
        if (!originalIdsByInternalId.has(internalId)) {
            originalIdsByInternalId.set(internalId, normalizeNonEmptyString(originalId));
        }
    }
    /** 批内逐条查询复用已选定的首个映射，仍使用调用方当前消息作降级。 */
    return (params: SessionMessageRouteInput): string | null => {
        const messageId = normalizeNonEmptyString(params.messageId);
        if (!messageId) return null;
        return buildSessionMessageRouteIdFromOriginal(
            messageId,
            params.messagesById[messageId],
            originalIdsByInternalId.get(messageId) ?? null,
        );
    };
}

export function resolveMessageRouteIdForDisplay(params: Readonly<{
    message: Message;
    messagesById: Readonly<Record<string, Message>>;
    reducerState: RouteLookupState | null | undefined;
}>): string {
    const directRouteMessageId = buildMessageRouteId(params.message);
    const sessionRouteMessageId = buildSessionMessageRouteId({
        messageId: params.message.id,
        messagesById: params.messagesById,
        reducerState: params.reducerState,
    });

    if (typeof sessionRouteMessageId === 'string' && sessionRouteMessageId.startsWith('server:')) {
        return sessionRouteMessageId;
    }

    if (directRouteMessageId !== params.message.id) {
        return directRouteMessageId;
    }

    return sessionRouteMessageId ?? directRouteMessageId;
}

export function resolveSessionMessageRouteId(params: Readonly<{
    routeMessageId: string;
    messagesById: Readonly<Record<string, Message>>;
    reducerState: RouteLookupState | null | undefined;
}>): string | null {
    const parsedRouteRef = parseStableSessionMessageRouteId(params.routeMessageId);
    const routeMessageId = parsedRouteRef?.kind === 'local'
        ? `local:${parsedRouteRef.value}`
        : normalizeNonEmptyString(params.routeMessageId);
    if (!routeMessageId) return null;

    if (params.messagesById[routeMessageId]) {
        return routeMessageId;
    }

    const stableRef = parsedRouteRef ?? parseStableSessionMessageRouteId(routeMessageId);
    if (stableRef?.kind === 'tool') {
        return (
            params.reducerState?.toolIdToMessageId.get(stableRef.value)
            ?? params.reducerState?.sidechainToolIdToMessageId.get(stableRef.value)
            ?? null
        );
    }
    if (stableRef?.kind === 'server') {
        return params.reducerState?.messageIds.get(stableRef.value) ?? null;
    }
    if (stableRef?.kind === 'local') {
        return params.reducerState?.localIds.get(stableRef.value) ?? null;
    }

    return (
        params.reducerState?.toolIdToMessageId.get(routeMessageId)
        ?? params.reducerState?.sidechainToolIdToMessageId.get(routeMessageId)
        ?? params.reducerState?.localIds.get(routeMessageId)
        ?? params.reducerState?.messageIds.get(routeMessageId)
        ?? null
    );
}
