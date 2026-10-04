import fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHash, timingSafeEqual } from 'node:crypto';
import { logger } from '@/ui/logger';
import { registerDaemonControlRequestTiming } from './diagnostics/registerDaemonControlRequestTiming';
import type { TrackedSession } from './types';
import type { StopSessionResult } from './sessions/stopSessionContract';
const DEFAULT_DAEMON_CONTROL_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const DAEMON_CONTROL_BODY_LIMIT_BYTES_ENV_KEY = 'HAPPIER_DAEMON_CONTROL_BODY_LIMIT_BYTES';
const DAEMON_DIST_CLOSURE_FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/;
const DaemonDistClosureFingerprintSchema = z.string().regex(DAEMON_DIST_CLOSURE_FINGERPRINT_PATTERN);
/** 沿原 owner 恒时比较控制令牌，不能接受其他能力令牌。 */
export function safeTokenEquals(provided: string, expected: string): boolean {
    const hashA = createHash('sha256').update(provided).digest();
    const hashB = createHash('sha256').update(expected).digest();
    return timingSafeEqual(hashA, hashB);
}
/** 沿原配置限制本地控制请求体，不改变原上下界。 */
function resolveDaemonControlBodyLimitBytes(): number {
    const raw = String(process.env[DAEMON_CONTROL_BODY_LIMIT_BYTES_ENV_KEY] ?? '').trim();
    if (!raw)
        return DEFAULT_DAEMON_CONTROL_BODY_LIMIT_BYTES;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_DAEMON_CONTROL_BODY_LIMIT_BYTES;
    }
    return Math.max(1024 * 1024, Math.min(parsed, 64 * 1024 * 1024));
}
export type DaemonSelfRestartRequest = Readonly<{
    successorDistClosureFingerprint?: string;
}>;
export type DaemonControlCoreOptions = Readonly<{
    getChildren: () => TrackedSession[];
    machineId: string;
    runtimeId?: string;
    stopSession: (sessionId: string) => Promise<StopSessionResult>;
    prepareStopSession?: (child: TrackedSession) => Promise<void> | void;
    requestShutdown: () => void;
    beforeShutdown?: () => Promise<void>;
    controlToken: string;
    isShuttingDown?: () => boolean;
    requestSelfRestart?: (request?: DaemonSelfRestartRequest) => Promise<unknown>;
}>;
/** 创建共享认证和生命周期路由，返回同一 app 供所选产品继续注册真实能力。 */
export function createDaemonControlCore({ getChildren, machineId, runtimeId = '', stopSession, prepareStopSession, requestShutdown, beforeShutdown, controlToken, isShuttingDown, requestSelfRestart }: DaemonControlCoreOptions) {
    void machineId;
    const normalizedRuntimeId = runtimeId.trim();
    const normalizedControlToken = controlToken.trim();
    if (!normalizedControlToken) {
        throw new Error('Daemon control token is required');
    }
    const app = fastify({
        logger: false, // We use our own logger
        bodyLimit: resolveDaemonControlBodyLimitBytes(),
    });
    registerDaemonControlRequestTiming(app, {
        debug: (message, data) => logger.debug(message, data),
    });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const authSchema401 = z.object({
        success: z.literal(false),
        error: z.string(),
    });
    const requireAuth = async (request: {
        headers: Record<string, unknown>;
    }, reply: any): Promise<void> => {
        const rawHeader = (request.headers as any)['x-happier-daemon-token'];
        const provided = typeof rawHeader === 'string' ? rawHeader : Array.isArray(rawHeader) ? rawHeader[0] : null;
        if (!provided || !safeTokenEquals(provided, normalizedControlToken)) {
            reply.code(401);
            return reply.send({ success: false as const, error: 'Unauthorized' });
        }
    };
    let restartState: 'idle' | 'restarting' = 'idle';
    typed.post('/ping', {
        schema: {
            response: {
                200: z.object({
                    status: z.literal('ok'),
                    runtimeId: z.string().min(1).optional(),
                    distClosureFingerprint: DaemonDistClosureFingerprintSchema.optional(),
                }),
                401: authSchema401,
            }
        },
        preHandler: requireAuth,
    }, async () => {
        const distClosureFingerprint = String(process.env.HAPPIER_CLI_SUBPROCESS_DAEMON_DIST_CLOSURE_FINGERPRINT ?? '').trim();
        return {
            status: 'ok' as const,
            ...(normalizedRuntimeId ? { runtimeId: normalizedRuntimeId } : {}),
            ...(DAEMON_DIST_CLOSURE_FINGERPRINT_PATTERN.test(distClosureFingerprint) ? { distClosureFingerprint } : {}),
        };
    });
    typed.post('/list', {
        schema: {
            response: {
                200: z.object({
                    children: z.array(z.object({
                        startedBy: z.string(),
                        happySessionId: z.string(),
                        pid: z.number(),
                        status: z.enum(['runner_alive', 'runner_alive_host_dead']),
                        terminalHostHealth: z.object({
                            status: z.literal('host_dead'),
                            sessionId: z.string(),
                            runnerPid: z.number(),
                            hostKind: z.string(),
                            zellijSessionName: z.string().optional(),
                            observedAt: z.number(),
                            reason: z.string(),
                        }).optional(),
                    }))
                }),
                401: authSchema401,
            }
        },
        preHandler: requireAuth,
    }, async () => {
        const children = getChildren();
        logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
        return {
            children: children
                .filter(child => child.happySessionId !== undefined)
                .map(child => ({
                startedBy: child.startedBy,
                happySessionId: child.happySessionId!,
                pid: child.pid,
                status: child.terminalHostHealth?.status === 'host_dead'
                    ? 'runner_alive_host_dead' as const
                    : 'runner_alive' as const,
                ...(child.terminalHostHealth?.status === 'host_dead'
                    ? { terminalHostHealth: child.terminalHostHealth }
                    : {}),
            }))
        };
    });
    typed.post('/restart', {
        schema: {
            body: z
                .object({
                stopSessions: z.boolean().optional(),
                restartSessionRunners: z.boolean().optional(),
                successorDistClosureFingerprint: DaemonDistClosureFingerprintSchema.optional(),
            })
                .strict()
                .nullish(),
            response: {
                202: z.object({
                    status: z.enum(['restarting', 'already_restarting']),
                }),
                401: authSchema401,
                409: z.object({
                    status: z.literal('shutting_down'),
                }),
                400: z.union([
                    z.object({
                        status: z.literal('unsupported_restart_options'),
                    }),
                    z.object({
                        statusCode: z.literal(400),
                        code: z.string(),
                        error: z.string(),
                        message: z.string(),
                    }),
                ]),
                501: z.object({
                    status: z.literal('restart_unavailable'),
                }),
            },
        },
        preHandler: requireAuth,
    }, async (request, reply) => {
        if (isShuttingDown?.() === true) {
            reply.code(409);
            return { status: 'shutting_down' as const };
        }
        if (!requestSelfRestart) {
            reply.code(501);
            return { status: 'restart_unavailable' as const };
        }
        if (request.body &&
            (request.body.stopSessions !== undefined || request.body.restartSessionRunners !== undefined)) {
            reply.code(400);
            return { status: 'unsupported_restart_options' as const };
        }
        if (restartState === 'restarting') {
            reply.code(202);
            return { status: 'already_restarting' as const };
        }
        restartState = 'restarting';
        setTimeout(() => {
            void (async () => {
                try {
                    const successorDistClosureFingerprint = request.body?.successorDistClosureFingerprint;
                    await requestSelfRestart(successorDistClosureFingerprint ? { successorDistClosureFingerprint } : undefined);
                }
                catch (error) {
                    logger.debug('[CONTROL SERVER] Daemon self-restart request failed; keeping current daemon alive', error);
                }
                finally {
                    restartState = 'idle';
                }
            })();
        }, 50);
        reply.code(202);
        return { status: 'restarting' as const };
    });
    typed.post('/stop', {
        schema: {
            body: z
                .object({
                stopSessions: z.boolean().optional(),
            })
                .nullish(),
            response: {
                200: z.object({
                    status: z.string()
                }),
                401: authSchema401,
            }
        },
        preHandler: requireAuth,
    }, async (request) => {
        const stopSessions = request.body?.stopSessions === true;
        logger.debug('[CONTROL SERVER] Stop daemon request received', { stopSessions });
        // Give time for response to arrive
        setTimeout(() => {
            logger.debug('[CONTROL SERVER] Triggering daemon shutdown');
            const runBeforeShutdown = async (): Promise<void> => {
                if (!beforeShutdown)
                    return;
                try {
                    await beforeShutdown();
                }
                catch (error) {
                    logger.debug('[CONTROL SERVER] beforeShutdown hook failed (best-effort)', error);
                }
            };
            void (async () => {
                try {
                    if (stopSessions) {
                        const children = getChildren();
                        logger.debug(`[CONTROL SERVER] stopSessions requested: stopping ${children.length} tracked sessions`);
                        for (const child of children) {
                            const sessionId = typeof child.happySessionId === 'string' ? child.happySessionId.trim() : '';
                            const fallbackSessionId = Number.isFinite(child.pid) && child.pid > 1 ? `PID-${Math.trunc(child.pid)}` : '';
                            const id = sessionId || fallbackSessionId;
                            if (!id)
                                continue;
                            try {
                                // eslint-disable-next-line no-await-in-loop
                                await prepareStopSession?.(child);
                            }
                            catch (error) {
                                logger.debug(`[CONTROL SERVER] Failed to prepare session ${id} before stop`, error);
                            }
                            try {
                                // eslint-disable-next-line no-await-in-loop
                                await stopSession(id);
                            }
                            catch (error) {
                                logger.debug(`[CONTROL SERVER] Failed to stop session ${id}`, error);
                            }
                        }
                    }
                    await runBeforeShutdown();
                }
                catch (error) {
                    logger.debug('[CONTROL SERVER] stopSessions failed', error);
                }
                finally {
                    requestShutdown();
                }
            })();
        }, 50);
        return { status: 'stopping' };
    });
    return { app, typed, requireAuth, authSchema401, normalizedControlToken };
}
/** 沿用唯一的监听和关闭流程；工厂异常仍通过返回的 Promise 拒绝。 */
export function listenDaemonControlApp(createApp: () => FastifyInstance): Promise<{
    port: number;
    stop: () => Promise<void>;
}> {
    return new Promise((resolve) => {
        const app = createApp();
        app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
            if (err) {
                logger.debug('[CONTROL SERVER] Failed to start:', err);
                throw err;
            }
            const port = parseInt(address.split(':').pop()!);
            logger.debug(`[CONTROL SERVER] Started on port ${port}`);
            resolve({
                port,
                stop: async () => {
                    logger.debug('[CONTROL SERVER] Stopping server');
                    await app.close();
                    logger.debug('[CONTROL SERVER] Server stopped');
                }
            });
        });
    });
}
