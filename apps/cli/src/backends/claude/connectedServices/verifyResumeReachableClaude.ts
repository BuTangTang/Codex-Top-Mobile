import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { VerifyResumeReachableResult } from '@/backends/connectedServices/verifyResumeReachableTypes';
import { resolveConfiguredClaudeConfigDir } from '@/backends/claude/utils/resolveConfiguredClaudeConfigDir';

export const CLAUDE_CONNECTED_SERVICES_LEGACY_RESTART_SAME_HOME_ENV =
  'HAPPIER_CONNECTED_SERVICES_LEGACY_CLAUDE_RESTART_SAME_HOME' as const;

function isLegacyClaudeConnectedServicesRollbackEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[CLAUDE_CONNECTED_SERVICES_LEGACY_RESTART_SAME_HOME_ENV] === '1';
}

function normalizeVendorResumeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed;
}

async function isReadableDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Provider reachability probe for Claude: is `<id>.jsonl` present where Claude's `--resume <id>`
 * reads (the target `CLAUDE_CONFIG_DIR/projects` store) — OR at the persisted candidate session
 * file that materialization WILL import before spawn (RD-MAT-5 / D8)?
 *
 * When `targetStrict` is set (the K1 §2 spawn gate, post-materialization), the candidate
 * source-proof is skipped: reachability must be proven from the EXACT final store the vendor reads.
 */
export async function verifyResumeReachableClaude(params: Readonly<{
  vendorResumeId: string | null | undefined;
  processEnv?: NodeJS.ProcessEnv;
  candidatePersistedSessionFile?: string | null;
  targetStrict?: boolean;
}>): Promise<VerifyResumeReachableResult> {
  const processEnv = params.processEnv ?? process.env;
  if (isLegacyClaudeConnectedServicesRollbackEnabled(processEnv)) {
    return { ok: true, resolvedPath: null };
  }

  const vendorResumeId = normalizeVendorResumeId(params.vendorResumeId);
  if (!vendorResumeId) {
    return { ok: false, reason: 'claude_session_not_in_native_store' };
  }

  const claudeConfigDir = resolveConfiguredClaudeConfigDir({ env: processEnv });
  const projectsDir = join(claudeConfigDir, 'projects');

  try {
    const projectEntries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of projectEntries) {
      const projectName = String(entry.name);
      if (entry.isSymbolicLink()) {
        // A symlinked project dir is still part of the store Claude reads; follow it.
        if (!await isReadableDirectory(join(projectsDir, projectName))) continue;
      } else if (!entry.isDirectory()) {
        continue;
      }
      const sessionPath = join(projectsDir, projectName, `${vendorResumeId}.jsonl`);
      try {
        const metadata = await stat(sessionPath);
        if (metadata.isFile()) {
          return { ok: true, resolvedPath: sessionPath };
        }
      } catch {
        // Ignore missing/unreadable file for this project and continue scanning others.
      }
    }
  } catch {
    if (params.targetStrict === true) {
      return { ok: false, reason: 'claude_native_store_unreachable' };
    }
    const candidateResult = await resolveCandidateSourceProof({
      vendorResumeId,
      candidatePersistedSessionFile: params.candidatePersistedSessionFile ?? null,
    });
    return candidateResult ?? { ok: false, reason: 'claude_native_store_unreachable' };
  }

  if (params.targetStrict !== true) {
    const candidateResult = await resolveCandidateSourceProof({
      vendorResumeId,
      candidatePersistedSessionFile: params.candidatePersistedSessionFile ?? null,
    });
    if (candidateResult) return candidateResult;
  }

  return { ok: false, reason: 'claude_session_not_in_native_store' };
}

async function resolveCandidateSourceProof(params: Readonly<{
  vendorResumeId: string;
  candidatePersistedSessionFile: string | null;
}>): Promise<VerifyResumeReachableResult | null> {
  const candidate = typeof params.candidatePersistedSessionFile === 'string'
    ? params.candidatePersistedSessionFile.trim()
    : '';
  if (!candidate) return null;
  if (basename(candidate).toLowerCase() !== `${params.vendorResumeId.toLowerCase()}.jsonl`) return null;
  if (!await isReadableFile(candidate)) return null;
  return { ok: true, resolvedPath: candidate };
}
