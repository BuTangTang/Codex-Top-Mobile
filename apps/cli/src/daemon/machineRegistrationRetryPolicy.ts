import { isMachineContentPublicKeyMismatchError } from '@/api/api';
import { isAuthenticationError } from '@/api/client/httpStatusError';

export function shouldRetryMachineRegistrationError(error: unknown): boolean {
  if (isMachineContentPublicKeyMismatchError(error)) return false;
  if (isAuthenticationError(error)) return false;
  return true;
}
