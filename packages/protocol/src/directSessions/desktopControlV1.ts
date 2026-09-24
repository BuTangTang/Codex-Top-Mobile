import { z } from 'zod';

/** 原桌面请求的可展示范围；详情不足时保留请求但禁止盲目决定。 */
export const DesktopApprovalV1Schema = z.object({
    requestId: z.string().min(1),
    revision: z.string().min(1),
    kind: z.enum(['command', 'file_change', 'unsupported']),
    canDecide: z.boolean(),
    reason: z.string().optional(),
    command: z.string().optional(),
    cwd: z.string().optional(),
    files: z.array(z.object({ path: z.string(), kind: z.string(), diff: z.string().optional() }).strict()).optional(),
}).strict();
export type DesktopApprovalV1 = z.infer<typeof DesktopApprovalV1Schema>;

/** 快照只用于当前原任务控制；不将历史记录时间或手机缓存当作活跃轮次。 */
export const DesktopControlSnapshotV1Schema = z.object({
    v: z.literal(1),
    turnId: z.string().min(1),
    state: z.enum(['running', 'completed', 'failed', 'cancelled']),
    // 仅证明该次原 owner 读取的文本选路；旧生产者缺失时不得凭历史状态放行。
    textSendMode: z.enum(['start', 'steer']).optional(),
    cwd: z.string().optional(),
    requests: z.array(DesktopApprovalV1Schema),
}).strict();
export type DesktopControlSnapshotV1 = z.infer<typeof DesktopControlSnapshotV1Schema>;

const target = z.object({ machineId: z.string().min(1), sessionId: z.string().min(1) });
export const DirectSessionControlReadRequestSchema = target.strict();
export const DirectSessionControlActionRequestSchema = z.discriminatedUnion('kind', [
    target.extend({ kind: z.literal('approval'), operationId: z.string().min(1), expectedTurnId: z.string().min(1), requestId: z.string().min(1), revision: z.string().min(1), decision: z.enum(['allow_once', 'deny']) }).strict(),
    target.extend({ kind: z.literal('steer'), operationId: z.string().min(1), expectedTurnId: z.string().min(1), text: z.string().min(1) }).strict(),
]);
export type DirectSessionControlActionRequest = z.infer<typeof DirectSessionControlActionRequestSchema>;
/** 审批 ACK 不证明决定实际生效，返回未知并由客户端读取当前请求状态核对。 */
export const DirectSessionControlResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('accepted'), turnId: z.string().min(1) }).strict(),
    z.object({ status: z.literal('unknown'), reason: z.string().min(1) }).strict(),
    z.object({ status: z.literal('rejected'), reason: z.string().min(1) }).strict(),
]);
export type DirectSessionControlResult = z.infer<typeof DirectSessionControlResultSchema>;

const controlError = z.object({ ok: z.literal(false), errorCode: z.string(), error: z.string() }).strict();
export const DirectSessionControlReadResponseSchema = z.union([
    z.object({ ok: z.literal(true), snapshot: DesktopControlSnapshotV1Schema }).strict(), controlError,
]);
export const DirectSessionControlActionResponseSchema = z.union([
    z.object({ ok: z.literal(true), result: DirectSessionControlResultSchema }).strict(), controlError,
]);
export type DirectSessionControlReadResponse = z.infer<typeof DirectSessionControlReadResponseSchema>;
export type DirectSessionControlActionResponse = z.infer<typeof DirectSessionControlActionResponseSchema>;
