import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

export function isPublicRouteForUnauthenticated(segments: string[]): boolean {
    // expo-router includes route groups like "(app)" in segments.
    const normalized = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));

    if (normalized.length === 0) return true;
    const first = normalized[0];

    // Home (welcome / login / create account)
    if (first === 'index') return true;

    // Desktop setup/onboarding must be reachable before authentication.
    if (first === 'setup') return true;

    // Server configuration must be reachable before authentication.
    if (first === 'server') return true;
    if (first === 'settings' && normalized[1] === 'server') return true;

    // Terminal connect links must be reachable before authentication so users can sign in and continue.
    if (first === 'terminal') return true;

    // Account-connect links must reach their route so signed-out users get recovery guidance.
    if (first === 'account') return true;

    // The transparent desktop pet overlay window is shell-owned and must not be redirected into setup.
    if (first === 'desktop' && normalized[1] === 'pet-overlay') return true;

    // Restore / link account flows must work unauthenticated.
    if (first === 'restore') return true;

    // OAuth return routes must be reachable before authentication so the callback can finalize.
    if (first === 'oauth') return true;

    // mTLS return routes must be reachable before authentication so the callback can finalize.
    if (first === 'mtls') return true;

    // Public share links must work unauthenticated.
    if (first === 'share') return true;

    return false;
}

/** 只读取单值路由参数，拒绝重复参数造成的来源歧义。 */
function authParam(params: Readonly<Record<string, unknown>>, key: string): string {
    const value = params[key];
    return typeof value === 'string' ? value.trim() : '';
}

/** 将明确来源的会话转换成既有首页登录返回地址，不保存账号或待办状态。 */
export function buildSessionAuthReturnTo(params: Readonly<Record<string, unknown>>): string | null {
    const id = authParam(params, 'id');
    const serverId = authParam(params, 'serverId');
    if (!id || !serverId) return null;
    const query = new URLSearchParams({ id, serverId, authReturn: '1' });
    for (const key of ['messageId', 'jumpChildId']) {
        const value = authParam(params, key);
        if (value) query.set(key, value);
    }
    return `/?${query.toString()}`;
}

/** 登录完成或继续恢复时，只允许沿当前服务器授权恢复原目标；普通链接不受影响。 */
export function resolveSessionAuthReturnTo(params: Readonly<Record<string, unknown>>, activeServerId: string): string | null {
    if (authParam(params, 'authReturn') !== '1') return null;
    if (!areServerProfileIdentifiersEquivalent(authParam(params, 'serverId'), activeServerId)) return null;
    return buildSessionAuthReturnTo(params);
}

/** 将已校验的会话参数附在已有恢复页面上，换服时自然丢弃原目标。 */
export function buildAuthRestoreRoute(path: string, params: Readonly<Record<string, unknown>>, activeServerId: string): string {
    const continuation = resolveSessionAuthReturnTo(params, activeServerId);
    return continuation ? `${path}${continuation.slice(1)}` : path;
}
