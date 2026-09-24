export type ConnectedServiceSameAccountFanoutStrategy =
  | 'provider_account_id'
  | 'shared_group_auth_surface'
  | 'none';

export function requiresExactProviderAccountFanout(
  strategy: ConnectedServiceSameAccountFanoutStrategy,
): boolean {
  return strategy === 'provider_account_id';
}
