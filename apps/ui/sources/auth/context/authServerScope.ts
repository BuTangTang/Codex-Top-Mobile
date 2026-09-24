import { getActiveServerSnapshot, type ActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';

export type AuthServerScope = Readonly<{
    expectedActiveServerSnapshot?: ActiveServerSnapshot;
    isStillValid?: () => boolean;
}>;

/** 登录离开原服务器或原页面后停止后续请求、写入与激活；往返同一服务器也检查代次。 */
export function assertAuthServerScopeCurrent(scope?: AuthServerScope): void {
    const expected = scope?.expectedActiveServerSnapshot;
    const current = expected ? getActiveServerSnapshot() : null;
    if (scope?.isStillValid?.() === false || (expected && current && (
        expected.serverId !== current.serverId || expected.serverUrl !== current.serverUrl || expected.generation !== current.generation
    ))) throw new Error('Authentication cancelled');
}
