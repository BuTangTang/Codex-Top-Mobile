import type {
    SessionMutationOutbox,
} from '@/api/session/mutations/createSessionMutationOutbox';
import type { SessionTurnMutationV1 } from '@/api/session/mutations/sessionMutationTypes';

export type SessionTurnMutationWriter = Readonly<{
    enqueueSessionTurn(mutation: SessionTurnMutationV1): Promise<void>;
}>;

export function createSessionTurnMutationWriter(outbox: SessionMutationOutbox): SessionTurnMutationWriter {
    return {
        enqueueSessionTurn: (mutation) => outbox.enqueueSessionTurn(mutation),
    };
}
