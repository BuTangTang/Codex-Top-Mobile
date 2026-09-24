import type { ExpoPushNotificationChannelV1 } from '@happier-dev/protocol';

import type { ActivityNotificationEvent } from './activityNotificationEvent';
import { buildActivityNotificationContent } from './buildActivityNotificationContent';

/** submitted 仅表示 Expo 接受提交，不代表手机或系统通知栏已收到。 */
export type ExpoPushSubmissionResult = Readonly<{
  status: 'submitted' | 'not_submitted' | 'unknown';
  reason?: 'no_targets' | 'rejected' | 'transport_unknown' | 'invalid_response';
}>;

export type ExpoPushActivityNotificationSender = Readonly<{
  sendToAllDevicesAsync: (title: string, body: string, data: Record<string, unknown>) => Promise<ExpoPushSubmissionResult | void>;
}>;

export async function sendExpoPushActivityNotificationAsync(params: Readonly<{
  channel: ExpoPushNotificationChannelV1;
  event: ActivityNotificationEvent;
  sender: ExpoPushActivityNotificationSender;
}>): Promise<ExpoPushSubmissionResult> {
  const built = buildActivityNotificationContent(params.event, {
    readyIncludeMessageText: params.channel.readyIncludeMessageText !== false,
    requestIncludeMessageText: params.channel.requestIncludeMessageText !== false,
  });
  // 旧 sender 的 void 没有提交证据，不能被新关注链路当成成功。
  return await params.sender.sendToAllDevicesAsync(built.title, built.body, built.data)
    ?? { status: 'unknown', reason: 'invalid_response' };
}
