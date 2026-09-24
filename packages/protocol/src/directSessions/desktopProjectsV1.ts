import { z } from 'zod';
import { DirectSessionsProviderIdSchema, DirectSessionsSourceSchema } from './daemonRpcV1.js';

/** 项目 ID 和根目录直接来自所选电脑的桌面项目配置，不能由历史 cwd 合成。 */
export const DesktopProjectV1Schema = z.object({
    id: z.string().min(1), name: z.string(), rootPaths: z.array(z.string().min(1)), available: z.boolean(), unavailableReason: z.string().optional(),
}).strict();
export type DesktopProjectV1 = z.infer<typeof DesktopProjectV1Schema>;
export const DirectSessionsProjectsListRequestSchema = z.object({
    machineId: z.string().min(1), providerId: DirectSessionsProviderIdSchema, source: DirectSessionsSourceSchema,
}).strict();
export const DirectSessionsProjectsListResponseSchema = z.union([
    z.object({ ok: z.literal(true), projects: z.array(DesktopProjectV1Schema), nativeCreate: z.literal(false), unavailableReason: z.literal('desktop_native_create_unavailable') }).strict(),
    z.object({ ok: z.literal(false), errorCode: z.string(), error: z.string() }).strict(),
]);
export type DirectSessionsProjectsListRequest = z.infer<typeof DirectSessionsProjectsListRequestSchema>;
export type DirectSessionsProjectsListResponse = z.infer<typeof DirectSessionsProjectsListResponseSchema>;
