import type {
  ConnectedServiceRuntimeAuthFailureKind,
  ConnectedServiceRuntimeLimitCategory,
} from './types';

/**
 * Canonical mapping from the shared provider limit-evidence categories
 * (`ConnectedServiceLimitCategoryV1`) to runtime-auth failure kinds. Shared by the provider
 * runtime-auth adapters (Pi/Gemini/OpenCode) so the category vocabulary maps identically
 * everywhere; categories without a runtime-auth meaning (`unknown`) return null.
 */
export function mapProviderLimitCategoryToRuntimeAuthFailureKind(
  category: ConnectedServiceRuntimeLimitCategory,
): ConnectedServiceRuntimeAuthFailureKind | null {
  switch (category) {
    case 'usage_limit':
      return 'usage_limit';
    case 'rate_limit':
      return 'rate_limit';
    case 'capacity':
      return 'capacity';
    case 'temporary_throttle':
      return 'temporary_throttle';
    case 'auth_invalid':
      return 'auth_expired';
    case 'plan_invalid':
      return 'plan';
    case 'validation_failed':
      return 'validation';
    case 'disabled':
      return 'account_disabled';
    case 'unknown':
      return null;
  }
}
