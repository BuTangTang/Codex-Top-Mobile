import * as React from 'react';
import { Platform } from 'react-native';
import { useDeviceType } from '@/utils/platform/responsive';
import { SessionWarningActionBanner } from '@/components/sessions/shell/SessionWarningActionBanner';

import { t } from '@/text';
import { useSessionDirectHistoryAvailability } from '@/sync/domains/state/storage';
import { ComposerAuxiliaryFrame } from '@/components/sessions/shell/view/ComposerAuxiliaryFrame';
import { ConversationNotice } from './ConversationNotice';

/** 历史可读性独立于运行状态与桌面控制能力；空正文也必须有可见说明。 */
export const DirectSessionHistoryNotice = React.memo(({ sessionId }: { sessionId: string }) => {
    const compactPhone = useDeviceType() === 'phone' && Platform.OS !== 'web';
    const availability = useSessionDirectHistoryAvailability(sessionId);
    if (!availability || availability === 'available') return null;
    const body = availability === 'preview_only' ? t('directSessions.historyPreviewOnly')
        : availability === 'unavailable' ? t('directSessions.historyUnavailable')
            : t('directSessions.historyAvailabilityUnknown');
    return (
        <ComposerAuxiliaryFrame>
            {compactPhone
                ? <ConversationNotice testID="direct-session-history-notice" body={body} />
                : <SessionWarningActionBanner testID="direct-session-history-notice" tone="neutral" iconName="info" body={body} />}
        </ComposerAuxiliaryFrame>
    );
});
