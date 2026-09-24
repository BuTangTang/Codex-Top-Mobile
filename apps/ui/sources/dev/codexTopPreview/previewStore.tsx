import * as React from 'react';

import {
    createInitialCodexTopPreviewState,
    resolveCodexTopPreviewApproval,
    sendCodexTopPreviewMessage,
    setCodexTopPreviewAppearance,
    setCodexTopPreviewNotifications,
    type CodexTopPreviewAppearance,
    type CodexTopPreviewState,
} from './sampleModel';

type CodexTopPreviewActions = {
    sendMessage: (sessionId: string, text: string) => void;
    resolveApproval: (sessionId: string, decision: 'confirm' | 'reject') => void;
    setAppearance: (appearance: CodexTopPreviewAppearance) => void;
    setNotifications: (enabled: boolean) => void;
};

const StateContext = React.createContext<CodexTopPreviewState | null>(null);
const ActionsContext = React.createContext<CodexTopPreviewActions | null>(null);

/**
 * 保存样板会话和本页设置。状态只活在这棵预览树里，不写入正式账号或同步存储。
 */
export function CodexTopPreviewStateProvider(props: { children: React.ReactNode }) {
    const [state, setState] = React.useState(createInitialCodexTopPreviewState);
    const actions = React.useMemo<CodexTopPreviewActions>(() => ({
        sendMessage(sessionId, text) {
            setState((current) => sendCodexTopPreviewMessage(current, sessionId, text));
        },
        resolveApproval(sessionId, decision) {
            setState((current) => resolveCodexTopPreviewApproval(current, sessionId, decision));
        },
        setAppearance(appearance) {
            setState((current) => setCodexTopPreviewAppearance(current, appearance));
        },
        setNotifications(enabled) {
            setState((current) => setCodexTopPreviewNotifications(current, enabled));
        },
    }), []);

    return (
        <ActionsContext.Provider value={actions}>
            <StateContext.Provider value={state}>
                {props.children}
            </StateContext.Provider>
        </ActionsContext.Provider>
    );
}

/**
 * 读取样板状态。预览树以外调用会直接失败，避免静默落到空数据。
 */
export function useCodexTopPreviewState(): CodexTopPreviewState {
    const state = React.useContext(StateContext);
    if (!state) throw new Error('Codex Top preview state is only available inside its preview root');
    return state;
}

/**
 * 读取样板操作。这些函数只调用本地合成状态的更新。
 */
export function useCodexTopPreviewActions(): CodexTopPreviewActions {
    const actions = React.useContext(ActionsContext);
    if (!actions) throw new Error('Codex Top preview actions are only available inside its preview root');
    return actions;
}
