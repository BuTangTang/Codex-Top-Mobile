import type {
  VerifyResumeReachableInput,
  VerifyResumeReachableResult,
} from '@/backends/connectedServices/verifyResumeReachableTypes';

export async function verifyResumeReachableOpenCode(
  _input: VerifyResumeReachableInput,
): Promise<VerifyResumeReachableResult> {
  return {
    ok: false,
    reason: 'opencode_state_not_shared',
  };
}
