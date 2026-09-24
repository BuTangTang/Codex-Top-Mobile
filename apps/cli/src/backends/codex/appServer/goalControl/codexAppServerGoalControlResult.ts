import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { CodexAppServerGoalControlError } from './codexAppServerGoalControlTypes';

export function unsupportedGoalControlMethod(method: string): CodexAppServerGoalControlError {
    return {
        ok: false,
        errorCode: 'unsupported_session_runtime_method',
        error: `unsupported_session_runtime_method:${method}`,
    };
}

export function unsupportedGoalGet(): CodexAppServerGoalControlError {
    return unsupportedGoalControlMethod(SESSION_RPC_METHODS.SESSION_GOAL_GET);
}

export function unsupportedGoalSet(): CodexAppServerGoalControlError {
    return unsupportedGoalControlMethod(SESSION_RPC_METHODS.SESSION_GOAL_SET);
}

export function unsupportedGoalClear(): CodexAppServerGoalControlError {
    return unsupportedGoalControlMethod(SESSION_RPC_METHODS.SESSION_GOAL_CLEAR);
}

export function goalThreadIdMissing(): CodexAppServerGoalControlError {
    return { ok: false, errorCode: 'goal_thread_id_missing', error: 'goal_thread_id_missing' };
}

export function goalNotFound(): CodexAppServerGoalControlError {
    return { ok: false, errorCode: 'goal_not_found', error: 'goal_not_found' };
}

export function goalObjectiveRequired(): CodexAppServerGoalControlError {
    return { ok: false, errorCode: 'goal_objective_required', error: 'goal_objective_required' };
}

export function invalidGoalStatus(): CodexAppServerGoalControlError {
    return { ok: false, errorCode: 'invalid_goal_status', error: 'invalid_goal_status' };
}
