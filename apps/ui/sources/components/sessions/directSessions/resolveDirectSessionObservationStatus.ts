import type { DirectSessionStatusGetResponse } from '@happier-dev/protocol';
import type { TranslationKey } from '@/text';

type Status = Extract<DirectSessionStatusGetResponse, { ok: true }>;
type ObservationDisplay = Readonly<{
    textKey: TranslationKey;
    colorKey: 'connecting' | 'actionRequired' | 'connected' | 'error' | 'disconnected';
}>;

const observationDisplays = {
    running: { textKey: 'directSessions.observation.running', colorKey: 'connecting' },
    needs_input: { textKey: 'directSessions.observation.needs_input', colorKey: 'actionRequired' },
    completed: { textKey: 'directSessions.observation.completed', colorKey: 'connected' },
    failed: { textKey: 'directSessions.observation.failed', colorKey: 'error' },
    cancelled: { textKey: 'directSessions.observation.cancelled', colorKey: 'disconnected' },
    unknown: { textKey: 'directSessions.observation.unknown', colorKey: 'disconnected' },
} as const satisfies Record<string, ObservationDisplay>;

/** 仅投影明确生命周期；旧活动、时间戳和发送结果都不能推断完成或等待审批。 */
export function resolveDirectSessionObservationStatus(status: Status | null): ObservationDisplay {
    const state = status?.machineOnline === false ? 'unknown' : status?.observation?.state ?? 'unknown';
    return observationDisplays[state];
}
