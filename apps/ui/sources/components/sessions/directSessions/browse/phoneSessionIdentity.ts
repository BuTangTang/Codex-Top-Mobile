import { stableJsonStringify } from '@/utils/json/stableJsonStringify';

/** 用结构化完整作用域区分历史会话，避免相同标题、远端 ID 或来源字段顺序造成误归属。 */
export function buildPhoneSessionIdentity(input: Readonly<{
    serverId: string;
    accountId: string;
    machineId: string;
    remoteSessionId: string;
    source: unknown;
}>): string {
    return stableJsonStringify([input.serverId, input.accountId, input.machineId, 'codex', input.source, input.remoteSessionId]);
}
