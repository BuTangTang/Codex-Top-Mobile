import type { AuthMethodModule } from '../types';
import { readAuthFeatureEnv } from '@/app/features/catalog/readFeatureEnv';
import { registerPasswordAuthRoutes } from '@/app/api/routes/auth/registerPasswordAuthRoutes';

/** 将账号密码接入原认证方法注册表；预建账号不提供公开注册动作。 */
export const passwordAuthMethodModule: AuthMethodModule = Object.freeze({
    id: 'password',
    // 仅披露真实启用状态，账号仍使用现有端到端加密密钥。
    resolveAuthMethod: ({ env }) => ({
        id: 'password',
        actions: [{ id: 'login', enabled: readAuthFeatureEnv(env).loginPasswordEnabled, mode: 'keyed' }],
        ui: { displayName: 'Account password', iconHint: null },
    }),
    // 同原注册表的锁定防护判断保持一致。
    isViable: (env) => readAuthFeatureEnv(env).loginPasswordEnabled,
    // 禁用时不注册可访问的密码接口。
    registerRoutes: (app) => {
        if (readAuthFeatureEnv(process.env).loginPasswordEnabled) registerPasswordAuthRoutes(app);
    },
});
