import type { PromptInvocationBehaviorV1 } from '@happier-dev/protocol';

import { expandPromptTemplateInvocation } from './expandPromptTemplateInvocation';
import { shouldInsertPromptInvocationOnAutocompleteSelect } from './promptInvocationBehavior';

export type PromptInvocationSuggestionMetadata = Readonly<{
    invocationId: string;
    token: string;
    targetArtifactId: string;
    behavior: PromptInvocationBehaviorV1;
    allowArgs: boolean;
}>;

export type PromptInvocationAutocompleteSelectionResult =
    | Readonly<{ handled: false }>
    | Readonly<{ handled: true; text: string; cursorPosition: number }>;

export async function resolvePromptInvocationAutocompleteSelection(args: Readonly<{
    promptInvocation?: PromptInvocationSuggestionMetadata | null;
    inputText: string;
    selection: Readonly<{ start: number; end: number }>;
    activeWord?: Readonly<{ offset: number; endOffset: number }> | null;
}>): Promise<PromptInvocationAutocompleteSelectionResult> {
    const promptInvocation = args.promptInvocation ?? null;
    if (!promptInvocation || !shouldInsertPromptInvocationOnAutocompleteSelect(promptInvocation.behavior)) {
        return { handled: false };
    }

    const expanded = await expandPromptTemplateInvocation({
        targetArtifactId: promptInvocation.targetArtifactId,
        argsText: '',
    });

    const start = args.activeWord?.offset ?? args.selection.start;
    const end = args.activeWord?.endOffset ?? args.selection.end;
    const text = `${args.inputText.slice(0, start)}${expanded}${args.inputText.slice(end)}`;

    return {
        handled: true,
        text,
        cursorPosition: start + expanded.length,
    };
}
