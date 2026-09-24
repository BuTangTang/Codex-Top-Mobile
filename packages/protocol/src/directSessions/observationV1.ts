import { z } from 'zod';

/** 稳定安全原因；不得把原生异常正文或本机路径传给客户端。 */
export const DirectSessionObservationUnknownReasonSchema = z.enum([
  'not_observed', 'connection_closed', 'owner_changed', 'incompatible_protocol',
  'invalid_snapshot', 'revision_gap', 'missing_turn_id', 'source_unavailable', 'unsupported_request',
]);
export type DirectSessionObservationUnknownReason = z.infer<typeof DirectSessionObservationUnknownReasonSchema>;

const known = z.object({
  v: z.literal(1),
  source: z.enum(['desktop', 'rollout']),
  turnId: z.string().min(1),
});

/** 文本、mtime、发送接受和工具错误均不属于本协议的生命周期事实。 */
export const DirectSessionObservationV1Schema = z.union([
  z.object({ v: z.literal(1), state: z.literal('unknown'), reason: DirectSessionObservationUnknownReasonSchema }).strict(),
  known.extend({ state: z.enum(['running', 'completed', 'failed', 'cancelled']) }).strict(),
  known.extend({
    state: z.literal('needs_input'),
    requests: z.array(z.object({
      requestId: z.string().min(1),
      kind: z.enum(['permission_request', 'user_action_request']),
    }).strict()).min(1),
  }).strict(),
]);
export type DirectSessionObservationV1 = z.infer<typeof DirectSessionObservationV1Schema>;

/** submitted 仅为供应商接受提交，绝不表示设备收到通知。 */
export const DirectSessionNotificationsV1Schema = z.object({
  capability: z.literal('explicit_lifecycle_v1'),
  enabled: z.boolean(),
  delivery: z.enum(['submitted', 'not_submitted', 'unknown']).optional(),
}).strict();
