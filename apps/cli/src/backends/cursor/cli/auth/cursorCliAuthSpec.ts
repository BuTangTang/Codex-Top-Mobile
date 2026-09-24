import { getProviderCliBinaryNames } from '@happier-dev/agents';

import type { CliAuthSpec, CliAuthStatusDraft } from '@/backends/types';
import { resolveCommonApiKeyStatus, runCliCommandBestEffort } from '@/capabilities/cliAuth/shared';

const DEFAULT_CURSOR_CLI_AUTH_PROBE_TIMEOUT_MS = 2_000;

function resolveCursorCliAuthProbeTimeoutMs(): number {
  const raw = process.env.HAPPIER_CURSOR_CLI_AUTH_PROBE_TIMEOUT_MS;
  const normalized = typeof raw === 'string' ? raw.replaceAll('_', '').trim() : '';
  const parsed = normalized ? Number(normalized) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CURSOR_CLI_AUTH_PROBE_TIMEOUT_MS;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : null;
}

function readCursorAccountLabel(parsed: unknown): string | null {
  const root = asRecord(parsed);
  const userInfo = asRecord(root?.userInfo) ?? asRecord(root?.user);
  return (
    readString(root, 'email') ??
    readString(root, 'userEmail') ??
    readString(userInfo, 'email') ??
    readString(userInfo, 'username') ??
    readString(root, 'subscriptionTier')
  );
}

function readPlainCursorAccountLabel(output: string): string | null {
  const loggedInAsMatch = output.match(/\blogged\s+in\s+as\s+([^\s]+)/iu);
  const emailMatch = output.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
  return loggedInAsMatch?.[1]?.trim() || emailMatch?.[0]?.trim() || null;
}

function isUnsupportedFormatOutput(output: string): boolean {
  return /(?:unknown|unrecognized|unsupported|invalid)\s+(?:option|flag|argument).*--format/iu.test(output)
    || /--format.*(?:unknown|unrecognized|unsupported|invalid)/iu.test(output);
}

function readCursorStatusAuthState(parsed: unknown): 'logged_in' | 'logged_out' | null {
  const root = asRecord(parsed);
  const explicitAuthenticated =
    readBoolean(root, 'isAuthenticated')
    ?? readBoolean(root, 'authenticated')
    ?? readBoolean(root, 'loggedIn');
  if (explicitAuthenticated !== null) {
    return explicitAuthenticated ? 'logged_in' : 'logged_out';
  }

  const normalizedStatus = readString(root, 'status')?.toLowerCase().replace(/[\s-]+/gu, '_') ?? null;
  if (normalizedStatus === 'authenticated' || normalizedStatus === 'logged_in') {
    return 'logged_in';
  }
  if (
    normalizedStatus === 'not_authenticated'
    || normalizedStatus === 'unauthenticated'
    || normalizedStatus === 'logged_out'
    || normalizedStatus === 'signed_out'
  ) {
    return 'logged_out';
  }

  const hasAccessToken = readBoolean(root, 'hasAccessToken');
  const hasRefreshToken = readBoolean(root, 'hasRefreshToken');
  if (hasAccessToken === true && hasRefreshToken === true) {
    return 'logged_in';
  }
  if (hasAccessToken === false && hasRefreshToken === false) {
    return 'logged_out';
  }

  return null;
}

function parseCursorAboutJson(stdout: string, stderr: string): CliAuthStatusDraft {
  const combined = `${stdout}\n${stderr}`.trim();
  if (combined.toLowerCase().includes('not logged in')) {
    return { state: 'logged_out', reason: 'missing_credentials', source: 'command' };
  }

  try {
    const parsed = JSON.parse(stdout) as unknown;
    const authState = readCursorStatusAuthState(parsed);
    if (authState === 'logged_out') {
      return { state: 'logged_out', reason: 'missing_credentials', source: 'command' };
    }
    const label = readCursorAccountLabel(parsed);
    if (authState === 'logged_in' || label) {
      return {
        state: 'logged_in',
        method: 'oauth_cli',
        ...(label ? { accountLabel: label } : {}),
        source: 'command',
      };
    }
    const plainLabel = readPlainCursorAccountLabel(combined);
    if (plainLabel) {
      return {
        state: 'logged_in',
        method: 'oauth_cli',
        accountLabel: plainLabel,
        source: 'command',
      };
    }
    return { state: 'unknown', reason: 'probe_failed', source: 'command' };
  } catch {
    const plainLabel = readPlainCursorAccountLabel(combined);
    if (plainLabel) {
      return {
        state: 'logged_in',
        method: 'oauth_cli',
        accountLabel: plainLabel,
        source: 'command',
      };
    }
    return {
      state: 'unknown',
      reason: isUnsupportedFormatOutput(combined) ? 'unsupported' : 'probe_failed',
      source: 'command',
    };
  }
}

function parseCursorStatusJson(stdout: string, stderr: string): CliAuthStatusDraft {
  const combined = `${stdout}\n${stderr}`.trim();
  if (/not\s+(?:logged\s+in|authenticated)/iu.test(combined)) {
    return { state: 'logged_out', reason: 'missing_credentials', source: 'command' };
  }

  try {
    const parsed = JSON.parse(stdout) as unknown;
    const authState = readCursorStatusAuthState(parsed);
    if (authState === 'logged_out') {
      return { state: 'logged_out', reason: 'missing_credentials', source: 'command' };
    }

    const label = readCursorAccountLabel(parsed);
    if (authState === 'logged_in' || label) {
      return {
        state: 'logged_in',
        method: 'oauth_cli',
        ...(label ? { accountLabel: label } : {}),
        source: 'command',
      };
    }

    return { state: 'unknown', reason: 'probe_failed', source: 'command' };
  } catch {
    const plainLabel = readPlainCursorAccountLabel(combined);
    if (plainLabel) {
      return {
        state: 'logged_in',
        method: 'oauth_cli',
        accountLabel: plainLabel,
        source: 'command',
      };
    }
    return {
      state: 'unknown',
      reason: isUnsupportedFormatOutput(combined) ? 'unsupported' : 'probe_failed',
      source: 'command',
    };
  }
}

async function readCursorStatusJsonAuthStatus(resolvedPath: string): Promise<CliAuthStatusDraft> {
  const result = await runCliCommandBestEffort({
    resolvedPath,
    args: ['status', '--format', 'json'],
    timeoutMs: resolveCursorCliAuthProbeTimeoutMs(),
  });
  const parsed = parseCursorStatusJson(result.stdout, result.stderr);
  if (result.ok || parsed.state !== 'unknown') {
    return parsed;
  }
  return {
    state: 'unknown',
    reason: parsed.reason === 'unsupported' ? 'unsupported' : 'probe_failed',
    source: 'command',
  };
}

export const cursorCliAuthSpec: CliAuthSpec = {
  get binaryNames() {
    return getProviderCliBinaryNames('cursor');
  },
  detectAuthStatus: async ({ resolvedPath }) => {
    const envStatus = resolveCommonApiKeyStatus(['CURSOR_API_KEY']);
    if (envStatus.state === 'logged_in') {
      return envStatus;
    }

    const result = await runCliCommandBestEffort({
      resolvedPath,
      args: ['about', '--format', 'json'],
      timeoutMs: resolveCursorCliAuthProbeTimeoutMs(),
    });
    if (result.ok) {
      const parsed = parseCursorAboutJson(result.stdout, result.stderr);
      if (parsed.state !== 'unknown') {
        return parsed;
      }
      const statusParsed = await readCursorStatusJsonAuthStatus(resolvedPath);
      return statusParsed.state === 'unknown' ? parsed : statusParsed;
    }
    const jsonParsed = parseCursorAboutJson(result.stdout, result.stderr);
    const statusParsed = await readCursorStatusJsonAuthStatus(resolvedPath);
    if (statusParsed.state !== 'unknown') {
      return statusParsed;
    }
    if (jsonParsed.reason === 'unsupported') {
      const plainResult = await runCliCommandBestEffort({
        resolvedPath,
        args: ['about'],
        timeoutMs: resolveCursorCliAuthProbeTimeoutMs(),
      });
      const plainParsed = parseCursorAboutJson(plainResult.stdout, plainResult.stderr);
      return plainParsed.state === 'unknown'
        ? { state: 'unknown', reason: 'unsupported', source: 'command' }
        : plainParsed;
    }
    if (typeof result.exitCode === 'number') {
      return jsonParsed.state === 'unknown'
        ? { state: 'unknown', reason: 'probe_failed', source: 'command' }
        : jsonParsed;
    }
    return { state: 'unknown', reason: 'probe_failed', source: 'command' };
  },
};
