import { createHash } from 'node:crypto';
import type { DesktopQuestionRequestV1 } from '@happier-dev/protocol';

/** 收窄原程序快照；本模块只作投影，不持有状态或启动观察。 */
function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 从已加载的最新尾岛选择原轮次，不把不完整历史的末项当当前任务。 */
export function readDesktopCurrentTurn(state: Record<string, unknown>): Record<string, unknown> | null {
    const container = record(state.turnHistory);
    if (container?.kind !== 'canonical') return Array.isArray(state.turns) ? record(state.turns.at(-1)) : null;
    const history = record(container.history);
    const islands = history?.islands;
    const island = Array.isArray(islands) ? record(islands.at(-1)) : null;
    if (record(island?.newerBoundary)?.status !== 'exhausted' || !Array.isArray(island?.entries)) return null;
    const key = record(island.entries.at(-1))?.value;
    return typeof key === 'string' ? record(record(history?.entitiesByKey)?.[key]) : null;
}

/** 原请求支持非空字符串或安全整数，不能把数字 ID 变为字符串。 */
function nativeId(value: unknown): value is string | number {
    return typeof value === 'string' && value.length > 0 || typeof value === 'number' && Number.isSafeInteger(value);
}

/** 修订绑定原题内容与身份；答案和运行状态变化不伪装成另一道题。 */
function revision(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** 校验原计划题的完整字段；缺失输入约束保持缺失，不能由选项推测自填。 */
function planQuestions(value: unknown): DesktopQuestionRequestV1['questions'] {
    if (!Array.isArray(value)) return [];
    const questions: DesktopQuestionRequestV1['questions'] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        const question = record(raw);
        if (typeof question?.id !== 'string' || !question.id || seen.has(question.id)
            || typeof question.header !== 'string' || typeof question.question !== 'string') return [];
        const options: DesktopQuestionRequestV1['questions'][number]['options'] = [];
        if (question.options != null && !Array.isArray(question.options)) return [];
        for (const rawOption of question.options ?? []) {
            const option = record(rawOption);
            if (typeof option?.label !== 'string' || typeof option.description !== 'string') return [];
            options.push({ label: option.label, description: option.description });
        }
        seen.add(question.id);
        questions.push({ id: question.id, header: question.header, question: question.question, options,
            ...(typeof question.isOther === 'boolean' ? { isOther: question.isOther } : {}),
            ...(typeof question.isSecret === 'boolean' ? { isSecret: question.isSecret } : {}) });
    }
    return questions;
}

/** 原 userInputResponse 保存问题 ID 到字符串数组的投影，不包装成另一种答案格式。 */
function planAnswers(value: unknown): Record<string, string[]> | undefined {
    const answers = record(value);
    if (!answers || Object.values(answers).some((answer) => !Array.isArray(answer) || answer.some((entry) => typeof entry !== 'string'))) return undefined;
    return Object.fromEntries(Object.entries(answers).map(([key, answer]) => [key, [...answer as string[]]]));
}

export type DesktopAsyncQuestionReply = Readonly<{ questionItemId: string; question: string; answer: string }>;

/** 只解析原程序的单 text 结构化封套；普通文本和未接受的 steer 不能算作答案。 */
export function readDesktopAsyncQuestionReplies(value: unknown): DesktopAsyncQuestionReply[] {
    const item = record(value);
    if (!item || item.type !== 'userMessage' && (item.type !== 'steeringUserMessage' || item.status !== 'accepted')) return [];
    const input = item.type === 'userMessage' ? item.content : item.input;
    if (!Array.isArray(input) || input.length !== 1) return [];
    const text = record(input[0]);
    if (text?.type !== 'text' || typeof text.text !== 'string') return [];
    const source = text.text.trim(), start = '<send_user_message_question_reply>', end = '</send_user_message_question_reply>';
    if (!source.startsWith(start) || !source.endsWith(end)) return [];
    try {
        const parsed: unknown = JSON.parse(source.slice(start.length, -end.length));
        const values = Array.isArray(parsed) ? parsed : [parsed];
        const replies: DesktopAsyncQuestionReply[] = [];
        for (const value of values) {
            const reply = record(value);
            if (typeof reply?.questionItemId !== 'string' || typeof reply.question !== 'string' || typeof reply.answer !== 'string') return [];
            replies.push({ questionItemId: reply.questionItemId, question: reply.question, answer: reply.answer });
        }
        return replies;
    } catch { return []; }
}

/** 同一尾轮投影计划请求与异步卡；控制、提交和观察共用此未答判定。 */
export function readDesktopQuestions(state: Record<string, unknown>, turn: Record<string, unknown>): DesktopQuestionRequestV1[] {
    const turnId = turn.turnId;
    if (typeof turnId !== 'string') return [];
    const running = turn.status === 'inProgress';
    const items = Array.isArray(turn.items) ? turn.items.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
    const result: DesktopQuestionRequestV1[] = [];
    const planIds = new Set<string | number>();
    for (const raw of Array.isArray(state.requests) ? state.requests : []) {
        const request = record(raw), params = record(request?.params);
        if (request?.method !== 'item/tool/requestUserInput' || !nativeId(request.id) || !params || params.threadId !== state.id
            || params.turnId !== turnId || typeof params.itemId !== 'string' || !params.itemId) continue;
        const questions = planQuestions(params.questions);
        const response = items.find((item) => item.type === 'userInputResponse' && item.requestId === request.id && item.turnId === turnId);
        const answered = response?.completed === true;
        const status = answered ? 'answered' : running && request.completed !== true ? 'pending' : 'expired';
        planIds.add(request.id);
        result.push({ kind: 'user_input', requestId: request.id, itemId: params.itemId, turnId,
            revision: revision([request.id, params]), status, canAnswer: status === 'pending' && questions.length > 0, questions,
            ...(answered && planAnswers(response?.answers) ? { answers: planAnswers(response?.answers) } : {}) });
    }
    for (const item of items) {
        if (item.type === 'userInputResponse' && nativeId(item.requestId) && item.turnId === turnId && !planIds.has(item.requestId)
            && typeof item.id === 'string' && item.id) {
            // 原程序删除已答请求且不保存原 itemId/输入标记；只展示真实答案项，不能重新开放。
            result.push({ kind: 'user_input', requestId: item.requestId, itemId: item.id, turnId,
                revision: revision([item.requestId, item.questions]), status: item.completed === true ? 'answered' : 'expired',
                canAnswer: false, questions: planQuestions(item.questions), ...(planAnswers(item.answers) ? { answers: planAnswers(item.answers) } : {}) });
        }
        if (item.type !== 'agentMessage' || typeof item.id !== 'string' || !item.id || !Array.isArray(item.questions) || !item.questions.length) continue;
        const questions: DesktopQuestionRequestV1['questions'] = [];
        for (const [index, raw] of item.questions.entries()) {
            const question = record(raw);
            if (typeof question?.title !== 'string' || question.options != null && (!Array.isArray(question.options) || question.options.some((option) => typeof option !== 'string'))) {
                questions.length = 0; break;
            }
            questions.push({ id: JSON.stringify(['request_user_input_async', item.id, index]), header: '', question: question.title,
                isOther: true, isSecret: false, options: (question.options as string[] | undefined ?? []).map((label) => ({ label, description: '' })) });
        }
        const answers: Record<string, string[]> = {};
        for (const replyItem of items) {
            if (replyItem.type === 'steeringUserMessage' && replyItem.targetTurnId !== turnId) continue;
            for (const reply of readDesktopAsyncQuestionReplies(replyItem)) {
                if (questions.some((question) => question.id === reply.questionItemId && question.question === reply.question))
                    Object.defineProperty(answers, reply.questionItemId, { value: [reply.answer], enumerable: true, configurable: true });
            }
        }
        const answered = questions.length > 0 && questions.every((question) => Object.hasOwn(answers, question.id));
        const status = answered ? 'answered' : running ? 'pending' : 'expired';
        result.push({ kind: 'async_questions', requestId: null, itemId: item.id, turnId,
            revision: revision([turnId, item.id, item.questions]), status, canAnswer: status === 'pending' && questions.length > 0,
            questions, ...(Object.keys(answers).length ? { answers } : {}) });
    }
    return result;
}
