import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDaemonControlCore, listenDaemonControlApp, type DaemonControlCoreOptions } from './controlServerCore';

/** 合成生命周期依赖不启动后台、不读取账号，也不执行子进程。 */
function options(overrides: Partial<DaemonControlCoreOptions> = {}): DaemonControlCoreOptions {
  return {
    getChildren: () => [], machineId: 'machine-synthetic', runtimeId: 'runtime-synthetic',
    stopSession: vi.fn(async () => ({ status: 'not_found' as const })),
    requestShutdown: vi.fn(), controlToken: 'synthetic-control-token', ...overrides,
  };
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('共享控制核心的能力边界', () => {
  it('拒绝缺少控制令牌的实例', () => {
    expect(() => createDaemonControlCore(options({ controlToken: '  ' }))).toThrow('Daemon control token is required');
  });

  it.each(['/ping', '/list', '/restart', '/stop'])('%s 拒绝未认证及错误令牌，不执行生命周期动作', async (url) => {
    const params = options({ requestSelfRestart: vi.fn(async () => {}) });
    const { app } = createDaemonControlCore(params);
    try {
      for (const headers of [{}, { 'x-happier-daemon-token': 'another-capability-token' }]) {
        const response = await app.inject({ method: 'POST', url, headers });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ success: false, error: 'Unauthorized' });
      }
      expect(params.requestSelfRestart).not.toHaveBeenCalled();
      expect(params.requestShutdown).not.toHaveBeenCalled();
      expect(params.stopSession).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([
    ['0123456789abcdef', '0123456789abcdef'],
    ['../foreign-runtime', undefined],
    ['', undefined],
  ])('ping 只发布经校验的运行时指纹 %s', async (configured, expected) => {
    vi.stubEnv('HAPPIER_CLI_SUBPROCESS_DAEMON_DIST_CLOSURE_FINGERPRINT', configured);
    const { app } = createDaemonControlCore(options());
    try {
      const response = await app.inject({ method: 'POST', url: '/ping', headers: { 'x-happier-daemon-token': 'synthetic-control-token' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', runtimeId: 'runtime-synthetic', ...(expected ? { distClosureFingerprint: expected } : {}) });
    } finally { await app.close(); }
  });

  it('未提供真实重启能力时明确返回不可用', async () => {
    const { app } = createDaemonControlCore(options());
    try {
      const response = await app.inject({ method: 'POST', url: '/restart', headers: { 'x-happier-daemon-token': 'synthetic-control-token' } });
      expect(response.statusCode).toBe(501);
      expect(response.json()).toEqual({ status: 'restart_unavailable' });
    } finally { await app.close(); }
  });

  it('产品扩展使用同一认证与 app，不默认暴露通用启动路由', async () => {
    const { app, typed, requireAuth } = createDaemonControlCore(options());
    typed.post('/synthetic-profile', { preHandler: requireAuth }, async () => ({ status: 'available' }));
    try {
      expect(app.hasRoute({ method: 'POST', url: '/spawn-session' })).toBe(false);
      const rejected = await app.inject({ method: 'POST', url: '/synthetic-profile' });
      expect(rejected.statusCode).toBe(401);
      const accepted = await app.inject({ method: 'POST', url: '/synthetic-profile', headers: { 'x-happier-daemon-token': 'synthetic-control-token' } });
      expect(accepted.json()).toEqual({ status: 'available' });
    } finally { await app.close(); }
  });

  it('停止前钩子异常也不会让退出请求永久挂起', async () => {
    const params = options({
      getChildren: () => [{ startedBy: 'daemon', pid: 4321, happySessionId: 'synthetic-session' }],
      prepareStopSession: vi.fn(async () => { throw new Error('prepare failed'); }),
      stopSession: vi.fn(async () => { throw new Error('stop failed'); }),
      beforeShutdown: vi.fn(async () => { throw new Error('before shutdown failed'); }),
    });
    const { app } = createDaemonControlCore(params);
    try {
      const response = await app.inject({ method: 'POST', url: '/stop', headers: { 'x-happier-daemon-token': 'synthetic-control-token' }, payload: { stopSessions: true } });
      expect(response.statusCode).toBe(200);
      await vi.waitFor(() => expect(params.requestShutdown).toHaveBeenCalledOnce());
      expect(params.prepareStopSession).toHaveBeenCalledOnce();
      expect(params.stopSession).toHaveBeenCalledOnce();
      expect(params.beforeShutdown).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });

  it('工厂失败保持原异步拒绝契约，不尝试监听', async () => {
    const start = listenDaemonControlApp(() => { throw new Error('synthetic creation failure'); });
    await expect(start).rejects.toThrow('synthetic creation failure');
  });
});
