import type { ConnectedServiceId } from '@happier-dev/protocol';
import { createHash } from 'node:crypto';

import { decodeJwtPayload } from '@/cloud/decodeJwtPayload';

export type QuotaPersistenceAccountScope =
  | Readonly<{ kind: 'known'; value: string }>
  | Readonly<{ kind: 'unknown' }>;

export function resolveQuotaPersistenceAccountScope(
  credentials?: Readonly<{ token?: string | null }>,
): QuotaPersistenceAccountScope {
  const normalizedToken = String(credentials?.token ?? '').trim();
  if (!normalizedToken) return { kind: 'unknown' };

  const payload = decodeJwtPayload(normalizedToken);
  const sub = typeof payload?.sub === 'string' ? payload.sub.trim() : '';
  if (sub) return { kind: 'known', value: `sub-${digestAccountScopePart(sub)}` };

  return { kind: 'known', value: `token-${digestAccountScopePart(normalizedToken)}` };
}

export function buildQuotaPersistenceKey(input: Readonly<{
  serverScope: string;
  accountScope: QuotaPersistenceAccountScope;
  serviceId: ConnectedServiceId;
  profileId: string;
}>): Readonly<{ key: string; diagnostics: Record<string, string> }> {
  const serverScopeHash = digestScope(input.serverScope);
  const accountScopeHash = input.accountScope.kind === 'known'
    ? digestScope(input.accountScope.value)
    : 'unknown-account';
  return {
    key: [
      'connected-service-quota',
      `server=${serverScopeHash}`,
      `account=${input.accountScope.kind}:${accountScopeHash}`,
      `service=${input.serviceId}`,
      `profile=${input.profileId}`,
    ].join('|'),
    diagnostics: {
      serverScopeHash,
      accountScope: input.accountScope.kind,
      accountScopeHash,
      serviceId: input.serviceId,
      profileId: input.profileId,
    },
  };
}

function digestScope(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 16);
}

function digestAccountScopePart(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 32);
}
