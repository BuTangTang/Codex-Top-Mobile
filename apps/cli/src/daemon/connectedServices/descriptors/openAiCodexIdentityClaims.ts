import { decodeJwtPayload } from '@/cloud/decodeJwtPayload';

function readDisplayText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractOpenAiCodexAccountId(idToken: string | null | undefined): string | null {
  const token = readDisplayText(idToken);
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const direct = readDisplayText(payload.chatgpt_account_id);
  if (direct) return direct;

  const authClaim = readRecord(payload['https://api.openai.com/auth']);
  return readDisplayText(authClaim?.chatgpt_account_id)
    ?? readDisplayText(authClaim?.account_id)
    ?? null;
}

export function extractOpenAiCodexEmail(idToken: string | null | undefined): string | null {
  const token = readDisplayText(idToken);
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const direct = readDisplayText(payload.email);
  if (direct) return direct;

  const profileClaim = readRecord(payload['https://api.openai.com/profile']);
  return readDisplayText(profileClaim?.email)
    ?? readDisplayText(profileClaim?.profile_email)
    ?? readDisplayText(profileClaim?.account_email)
    ?? null;
}
