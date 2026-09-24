import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  VerifyResumeReachableInput,
  VerifyResumeReachableResult,
} from '@/backends/connectedServices/verifyResumeReachableTypes';

import {
  findGeminiChatSessionFile,
  readGeminiChatSessionFileSessionId,
} from './geminiChatSessionFiles';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Provider reachability probe for Gemini: is the chat session file for `vendorResumeId` present
 * in the home Gemini CLI reads on ACP `loadSession` — or in a source the switch WILL import
 * before spawn (the candidate persisted file hint or the native `~/.gemini` home)?
 *
 * When `input.targetStrict` is set (the spawn-time §2 gate), reachability is proven ONLY from the
 * EXACT final home the materialized Gemini process reads (`GEMINI_CLI_HOME`/`HOME` of the target
 * materialized env), so a chat that exists only in a source/staging location cannot produce a
 * false-positive spawn gate. The non-strict (early continuity) probe keeps the broad source-proof
 * search, matching the Pi reference shape.
 */
export async function verifyResumeReachableGemini(
  input: VerifyResumeReachableInput,
): Promise<VerifyResumeReachableResult> {
  const sessionId = asNonEmptyString(input.vendorResumeId);
  if (!sessionId) {
    return { ok: false, reason: 'gemini_session_file_not_found' };
  }
  const targetStrict = input.targetStrict === true;
  const cwd = asNonEmptyString(input.cwd);

  const candidatePersistedSessionFile = asNonEmptyString(input.candidatePersistedSessionFile);
  if (
    !targetStrict
    && candidatePersistedSessionFile
    && await readGeminiChatSessionFileSessionId(candidatePersistedSessionFile) === sessionId
  ) {
    return { ok: true, resolvedPath: candidatePersistedSessionFile };
  }

  const targetHome = asNonEmptyString(input.targetMaterializedEnv.GEMINI_CLI_HOME)
    ?? asNonEmptyString(input.targetMaterializedEnv.HOME)
    ?? join(input.targetMaterializedRoot, 'home');
  const targetMatch = await findGeminiChatSessionFile({
    geminiDir: join(targetHome, '.gemini'),
    sessionId,
    cwd,
  });
  if (targetMatch) {
    return { ok: true, resolvedPath: targetMatch.filePath };
  }
  if (targetStrict) {
    return { ok: false, reason: 'gemini_session_file_not_found' };
  }

  // Native source proof: a native->connected switch imports the chat into the target home at
  // materialization time, so a chat present in the native home counts as reachable here. The
  // spawn path re-verifies against the real materialized home before launch (targetStrict).
  const nativeMatch = await findGeminiChatSessionFile({
    geminiDir: join(homedir(), '.gemini'),
    sessionId,
    cwd,
  });
  if (nativeMatch) {
    return { ok: true, resolvedPath: nativeMatch.filePath };
  }

  return { ok: false, reason: 'gemini_session_file_not_found' };
}
