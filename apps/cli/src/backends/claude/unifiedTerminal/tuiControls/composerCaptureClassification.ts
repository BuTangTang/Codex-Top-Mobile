import { isPlainComposerCaptureAmbiguous, type ClaudeScreenState } from './screenState';

export function isClaudeComposerCaptureStyleUnavailablePlaceholderCandidate(
  rawText: string,
  screen: ClaudeScreenState,
): boolean {
  return isPlainComposerCaptureAmbiguous({ rawText, screen });
}
