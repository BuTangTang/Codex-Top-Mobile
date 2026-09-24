import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAuthFeature } from '@/app/features/authFeature';
import { resolveAuthMethodRegistry } from '@/app/auth/methods/registry';
import { createFakeRouteApp } from '@/app/api/testkit/routeHarness';

afterEach(() => vi.unstubAllEnvs());
describe('password auth registration', () => {
    it('默认禁用，显式开启只提供登录且实际注册两个受限接口', () => {
        const disabled = resolveAuthFeature({});
        expect(disabled.capabilities?.auth?.methods?.find((item) => item.id === 'password')?.actions).toEqual([{ id: 'login', enabled: false, mode: 'keyed' }]);
        vi.stubEnv('HAPPIER_FEATURE_AUTH_LOGIN__PASSWORD_ENABLED', '1');
        const feature = resolveAuthFeature(process.env);
        expect(feature.capabilities?.auth?.methods?.find((item) => item.id === 'password')?.actions).toEqual([{ id: 'login', enabled: true, mode: 'keyed' }]);
        const method = resolveAuthMethodRegistry(process.env).find((item) => item.id === 'password')!;
        const app = createFakeRouteApp();
        method.registerRoutes(app as never);
        expect([...app.routes.keys()]).toEqual(['POST /v1/auth/password/parameters', 'POST /v1/auth/password/login']);
        expect(app.routes.get('POST /v1/auth/password/login')?.opts.config?.rateLimit).toMatchObject({ max: 5 });
        vi.stubEnv('HAPPIER_FEATURE_AUTH_LOGIN__PASSWORD_ENABLED', '0');
        const closed = createFakeRouteApp();
        method.registerRoutes(closed as never);
        expect(closed.routes.size).toBe(0);
    });
});
