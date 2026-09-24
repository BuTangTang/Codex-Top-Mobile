import type { PromptInvocationBehaviorV1 } from '@happier-dev/protocol';

export type PromptInvocationComposerSendAction = 'insert' | 'send';

export function resolvePromptInvocationComposerSendAction(
    behavior: PromptInvocationBehaviorV1,
): PromptInvocationComposerSendAction {
    return behavior === 'insert_and_send' ? 'send' : 'insert';
}

export function shouldInsertPromptInvocationOnAutocompleteSelect(
    behavior: PromptInvocationBehaviorV1,
): boolean {
    return behavior === 'insert';
}
