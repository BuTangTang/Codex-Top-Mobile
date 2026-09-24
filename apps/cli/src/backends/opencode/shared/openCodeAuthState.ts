import { join } from 'node:path';
import { URLSearchParams } from 'node:url';

import { readJsonFileSafe, joinHomePath } from '@/capabilities/cliAuth/shared';
import {
  resolveOpenAiCodexOauthClientId,
  resolveOpenAiCodexOauthTokenUrl,
} from '@/daemon/connectedServices/shared/oauthConfig';

type OpenCodeAuthFile = Readonly<{
  openai?: unknown;
}>;

type OpenCodeOauthAuthEntry = Readonly<{
  refresh?: unknown;
}>;

export type OpenCodeOauthRefreshTokenProbeState = 'valid' | 'invalid' | 'unknown';

const DEFAULT_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS = 6_000;

function resolveOpenCodeAuthJsonPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdgDataHome = typeof env.XDG_DATA_HOME === 'string' && env.XDG_DATA_HOME.trim().length > 0
    ? env.XDG_DATA_HOME.trim()
    : joinHomePath('.local', 'share');
  return join(xdgDataHome, 'opencode', 'auth.json');
}

function resolveOpenCodeOauthRefreshTokenProbeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HAPPIER_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS;
}

export function readOpenCodeOauthRefreshToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const parsed = readJsonFileSafe(resolveOpenCodeAuthJsonPath(env));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as OpenCodeAuthFile;
  if (!record.openai || typeof record.openai !== 'object' || Array.isArray(record.openai)) return null;

  const openai = record.openai as OpenCodeOauthAuthEntry;
  const refreshToken = typeof openai.refresh === 'string' ? openai.refresh.trim() : '';
  return refreshToken.length > 0 ? refreshToken : null;
}

export async function probeOpenAiCodexOauthRefreshToken(
  refreshToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpenCodeOauthRefreshTokenProbeState> {
  const trimmed = refreshToken.trim();
  if (!trimmed) return 'invalid';

  const controller = new AbortController();
  const timeoutMs = resolveOpenCodeOauthRefreshTokenProbeTimeoutMs(env);
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(resolveOpenAiCodexOauthTokenUrl(env), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: resolveOpenAiCodexOauthClientId(env),
        refresh_token: trimmed,
      }),
      signal: controller.signal,
    }).catch(() => null);

    if (!response) {
      return 'unknown';
    }
    if (response.ok) {
      return 'valid';
    }
    if (response.status === 400 || response.status === 401) {
      return 'invalid';
    }
    return 'unknown';
  } finally {
    clearTimeout(timeoutHandle);
  }
}
