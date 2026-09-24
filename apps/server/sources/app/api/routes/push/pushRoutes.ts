import { inTx } from '@/storage/inTx';
import { z } from "zod";
import { type Fastify } from "../../types";
import { db } from "@/storage/db";
import { redactSentryLogAttributes } from "@/app/monitoring/sentryLogRedaction";

/** 规范客户端服务地址提示，不把查询参数写入推送注册记录。 */
function normalizeClientServerUrl(raw: unknown): string | null {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString().replace(/\/+$/, "");
    } catch {
        return null;
    }
}

/** 推送 token 沿原路由管理；同一设备在同服务只保留当前账号归属。 */
export function pushRoutes(app: Fastify) {
    
    // Push Token Registration API
    app.post('/v1/push-tokens', {
        schema: {
            body: z.object({
                token: z.string(),
                clientServerUrl: z.string().optional(),
            }),
            response: {
                200: z.object({
                    success: z.literal(true)
                }),
                500: z.object({
                    error: z.literal('Failed to register push token')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { token } = request.body;
        const rawClientServerUrl = (request.body as any)?.clientServerUrl;
        const clientServerUrl =
            rawClientServerUrl === undefined ? undefined : normalizeClientServerUrl(rawClientServerUrl);

        try {
            const update: Record<string, unknown> = {
                updatedAt: new Date(),
            };
            if (clientServerUrl !== undefined) {
                update.clientServerUrl = clientServerUrl;
            }

            // 同一事务串行转交设备 token；旧账号迟到 DELETE 仍只能删除自己的记录。
            await inTx(async (tx) => {
                await tx.accountPushToken.deleteMany({ where: { token, accountId: { not: userId } } });
                await tx.accountPushToken.upsert({
                    where: {
                        accountId_token: {
                            accountId: userId,
                            token: token
                        }
                    },
                    update,
                    create: {
                        accountId: userId,
                        token: token,
                        clientServerUrl: clientServerUrl ?? null,
                    }
                });
            });

            return reply.send({ success: true });
        } catch (error) {
            app.log.error({ err: error, userId }, 'Failed to register push token');
            return reply.code(500).send({ error: 'Failed to register push token' });
        }
    });

    // Delete Push Token API
    app.delete('/v1/push-tokens/:token', {
        schema: {
            params: z.object({
                token: z.string()
            }),
            response: {
                200: z.object({
                    success: z.literal(true)
                }),
                500: z.object({
                    error: z.literal('Failed to delete push token')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { token } = request.params;

        try {
            await db.accountPushToken.deleteMany({
                where: {
                    accountId: userId,
                    token: token
                }
            });

            return reply.send({ success: true });
        } catch (error) {
            app.log.error(redactSentryLogAttributes({ err: error, userId, token }), 'Failed to delete push token');
            return reply.code(500).send({ error: 'Failed to delete push token' });
        }
    });

    // Get Push Tokens API
    app.get('/v1/push-tokens', {
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;

        try {
            const tokens = await db.accountPushToken.findMany({
                where: {
                    accountId: userId
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            return reply.send({
                tokens: tokens.map(t => ({
                    id: t.id,
                    token: t.token,
                    createdAt: t.createdAt.getTime(),
                    updatedAt: t.updatedAt.getTime(),
                    clientServerUrl: t.clientServerUrl ?? null,
                }))
            });
        } catch (error) {
            app.log.error({ err: error, userId }, 'Failed to get push tokens');
            return reply.code(500).send({ error: 'Failed to get push tokens' });
        }
    });
}
