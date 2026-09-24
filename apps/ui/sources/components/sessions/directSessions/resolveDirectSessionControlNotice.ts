import type { DirectSessionStatusGetResponse } from '@happier-dev/protocol';
import { t } from '@/text';

type DirectControlStatus = Pick<Extract<DirectSessionStatusGetResponse, { ok: true }>, 'machineOnline' | 'externalControl'>;

/** 页脚与发送拒绝复用同一能力解释；只翻译已知原因，绝不展示原始诊断。 */
export function resolveDirectSessionControlNotice(status: DirectControlStatus | null, inheritsDesktopSettings: boolean): string {
    if (status?.machineOnline === false) return t('chatFooter.directSessionMachineOffline');
    // 能力缺失无法识别 provider；沿用调用方既有桌面设置上下文，其他 Direct 保留原说明。
    if (!inheritsDesktopSettings) return t('chatFooter.directSessionTakeoverAvailable');
    const control = status?.externalControl;
    if (!control) return t('chatFooter.directSessionDesktopUnknown');
    if (control.canSend) return t('chatFooter.directSessionDesktopReady');
    switch (control.unavailableReason) {
        case 'owner_unavailable':
        case 'owner_changed':
        case 'router_unavailable':
        case 'connection_closed':
            return t('chatFooter.directSessionDesktopDisconnected');
        case 'incompatible_protocol':
        case 'unsupported_platform':
            return t('chatFooter.directSessionDesktopUnsupported');
        default:
            return t('chatFooter.directSessionDesktopUnavailable');
    }
}
