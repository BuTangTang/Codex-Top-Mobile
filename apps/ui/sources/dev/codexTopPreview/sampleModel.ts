export const CODEX_TOP_PREVIEW_PHASES = ['running', 'pending', 'done'] as const;

export type CodexTopPreviewPhase = (typeof CODEX_TOP_PREVIEW_PHASES)[number];

export type CodexTopPreviewAppearance = 'system' | 'light' | 'dark';

export type CodexTopPreviewMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    /** 为真时对话页才显示确认和拒绝。确认或拒绝后变为假。 */
    approvalPending: boolean;
};

export type CodexTopPreviewSession = {
    id: string;
    title: string;
    updatedLabel: string;
    computerId: string;
    computerName: string;
    projectName: string;
    phase: CodexTopPreviewPhase;
    messages: readonly CodexTopPreviewMessage[];
};

export type CodexTopPreviewComputer = {
    id: string;
    name: string;
    projectName: string;
    /** 固定为真，表示这台电脑是写死的合成示例。 */
    example: true;
};

export type CodexTopPreviewState = {
    computer: CodexTopPreviewComputer;
    sessions: readonly CodexTopPreviewSession[];
    appearance: CodexTopPreviewAppearance;
    notificationsEnabled: boolean;
};

const EXAMPLE_COMPUTER: CodexTopPreviewComputer = {
    id: 'example-computer',
    name: '示例电脑',
    projectName: 'codex-top',
    example: true,
};

/**
 * 生成样板消息 id。只根据当前条数递增，不使用随机数或时钟。
 */
function nextMessageId(session: CodexTopPreviewSession): string {
    return `${session.id}-local-${session.messages.length + 1}`;
}

/**
 * 替换一条会话并保留其它会话的原引用。找不到目标时返回原状态。
 */
function replaceSession(
    state: CodexTopPreviewState,
    sessionId: string,
    update: (session: CodexTopPreviewSession) => CodexTopPreviewSession,
): CodexTopPreviewState {
    const index = state.sessions.findIndex((session) => session.id === sessionId);
    const current = index >= 0 ? state.sessions[index] : undefined;
    if (!current) return state;
    const nextSession = update(current);
    if (nextSession === current) return state;
    const sessions = state.sessions.slice();
    sessions[index] = nextSession;
    return { ...state, sessions };
}

/**
 * 建立全部合成状态。会话都挂在同一台示例电脑上，不读取本机 Codex 或账号。
 */
export function createInitialCodexTopPreviewState(): CodexTopPreviewState {
    const source = {
        computerId: EXAMPLE_COMPUTER.id,
        computerName: EXAMPLE_COMPUTER.name,
        projectName: EXAMPLE_COMPUTER.projectName,
    };
    return {
        computer: EXAMPLE_COMPUTER,
        appearance: 'system',
        notificationsEnabled: true,
        sessions: [
            {
                ...source,
                id: 'sample-fix-duplicate',
                title: '修复消息重复',
                updatedLabel: '14:08',
                phase: 'running',
                messages: [
                    { id: 'sample-fix-duplicate-1', role: 'user', text: '请看示例里重复出现的那句回复。', approvalPending: false },
                    { id: 'sample-fix-duplicate-2', role: 'assistant', text: '示例回复：正在查看重复片段。', approvalPending: false },
                ],
            },
            {
                ...source,
                id: 'sample-login-layout',
                title: '登录页面调整',
                updatedLabel: '14:06',
                phase: 'running',
                messages: [
                    { id: 'sample-login-layout-1', role: 'user', text: '把示例登录页收紧一点。', approvalPending: false },
                    { id: 'sample-login-layout-2', role: 'assistant', text: '示例回复：正在调整间距。', approvalPending: false },
                ],
            },
            {
                ...source,
                id: 'sample-delete-index',
                title: '确认删除旧索引',
                updatedLabel: '13:40',
                phase: 'pending',
                messages: [
                    { id: 'sample-delete-index-1', role: 'user', text: '删除示例索引前先问我。', approvalPending: false },
                    { id: 'sample-delete-index-2', role: 'assistant', text: '示例：确认删除旧索引？', approvalPending: true },
                ],
            },
            {
                ...source,
                id: 'sample-usage-note',
                title: '补充使用说明',
                updatedLabel: '11:15',
                phase: 'done',
                messages: [
                    { id: 'sample-usage-note-1', role: 'user', text: '给示例补一句使用说明。', approvalPending: false },
                    { id: 'sample-usage-note-2', role: 'assistant', text: '示例回复：说明已经写好。', approvalPending: false },
                ],
            },
        ],
    };
}

/**
 * 返回三态标签的中文名。首页只靠这个分类表达状态，不再另放状态徽章。
 */
export function codexTopPreviewPhaseLabel(phase: CodexTopPreviewPhase): string {
    if (phase === 'running') return '运行中';
    if (phase === 'pending') return '待处理';
    return '已完成';
}

/**
 * 拼出会话第二行来源。只保留电脑名和项目名，不展示本机路径。
 */
export function formatCodexTopPreviewSource(session: Pick<CodexTopPreviewSession, 'computerName' | 'projectName'>): string {
    return `${session.computerName} · ${session.projectName}`;
}

/**
 * 判断这条示例会话是否还在等用户确认。没有待审批消息时对话页不显示确认或拒绝。
 */
export function sessionHasPendingApproval(session: CodexTopPreviewSession): boolean {
    return session.messages.some((message) => message.approvalPending);
}

/**
 * 按分类和搜索词列出首页会话。搜索只匹配标题、电脑名和项目名，不把消息正文堆进列表。
 */
export function listCodexTopPreviewSessions(
    state: CodexTopPreviewState,
    phase: CodexTopPreviewPhase,
    query: string,
): readonly CodexTopPreviewSession[] {
    const needle = query.trim().toLowerCase();
    return state.sessions.filter((session) => {
        if (session.phase !== phase) return false;
        if (!needle) return true;
        const haystack = `${session.title}\n${session.computerName}\n${session.projectName}`.toLowerCase();
        return haystack.includes(needle);
    });
}

/**
 * 把用户输入追加到指定会话。空白输入或未知会话保持原状态引用。
 * 不改变分类，也不调用任何真实会话或审批能力。
 */
export function sendCodexTopPreviewMessage(
    state: CodexTopPreviewState,
    sessionId: string,
    text: string,
): CodexTopPreviewState {
    const body = text.trim();
    if (!body) return state;
    return replaceSession(state, sessionId, (session) => ({
        ...session,
        messages: [
            ...session.messages,
            { id: nextMessageId(session), role: 'user', text: body, approvalPending: false },
        ],
    }));
}

/**
 * 在样板里确认或拒绝待审批。只把该会话标为已完成并清掉待审批标记。
 * 这不表示真实 Codex 任务已经执行；没有待审批时保持原状态。
 */
export function resolveCodexTopPreviewApproval(
    state: CodexTopPreviewState,
    sessionId: string,
    decision: 'confirm' | 'reject',
): CodexTopPreviewState {
    return replaceSession(state, sessionId, (session) => {
        if (!sessionHasPendingApproval(session)) return session;
        const note = decision === 'confirm' ? '示例：已确认' : '示例：已拒绝';
        return {
            ...session,
            phase: 'done',
            messages: [
                ...session.messages.map((message) => (
                    message.approvalPending ? { ...message, approvalPending: false } : message
                )),
                { id: nextMessageId(session), role: 'assistant', text: note, approvalPending: false },
            ],
        };
    });
}

/**
 * 更新样板外观偏好。值没变时返回原状态，避免无意义刷新。
 */
export function setCodexTopPreviewAppearance(
    state: CodexTopPreviewState,
    appearance: CodexTopPreviewAppearance,
): CodexTopPreviewState {
    if (state.appearance === appearance) return state;
    return { ...state, appearance };
}

/**
 * 更新样板通知开关。只改本地示例标记，不申请系统通知权限。
 */
export function setCodexTopPreviewNotifications(
    state: CodexTopPreviewState,
    notificationsEnabled: boolean,
): CodexTopPreviewState {
    if (state.notificationsEnabled === notificationsEnabled) return state;
    return { ...state, notificationsEnabled };
}
