import type { ConnectedServiceBindingsV1, ConnectedServiceId } from '@happier-dev/protocol';

type AuthGroupLookup = Readonly<{
  getConnectedServiceAuthGroup(input: Readonly<{ serviceId: ConnectedServiceId; groupId: string }>):
    Promise<Readonly<{ activeProfileId?: string | null }> | null>;
}>;

function readGroupBindingGroupId(binding: unknown): string | null {
  if (!binding || typeof binding !== 'object') return null;
  const record = binding as Record<string, unknown>;
  if (record.source !== 'connected' || record.selection !== 'group') return null;
  const groupId = typeof record.groupId === 'string' ? record.groupId.trim() : '';
  return groupId.length > 0 ? groupId : null;
}

/**
 * Resolve the live pre-switch active member for each GROUP-bound service in the session's current
 * bindings, so a MANUAL auth switch's transcript "from" is the real member instead of null (which the
 * UI renders as the native / "CLI Auth" label). The persisted group binding stores only the group id,
 * not the live member — this mirrors the automatic path's `emitFromProfileIdByServiceId` threading,
 * but for the manual (RPC-driven) switch the member is read from the group's authoritative state
 * BEFORE the switch is applied. Best-effort: a service is omitted on any lookup failure or a group
 * with no active member, so the emit cleanly falls back to the previous binding's profile.
 */
export async function resolveManualSwitchPreviousGroupMembers(input: Readonly<{
  api: AuthGroupLookup;
  previousBindings: ConnectedServiceBindingsV1;
}>): Promise<Map<ConnectedServiceId, string | null>> {
  const result = new Map<ConnectedServiceId, string | null>();
  const byServiceId = input.previousBindings?.bindingsByServiceId ?? {};
  for (const [serviceId, binding] of Object.entries(byServiceId)) {
    const groupId = readGroupBindingGroupId(binding);
    if (!groupId) continue;
    try {
      const group = await input.api.getConnectedServiceAuthGroup({
        serviceId: serviceId as ConnectedServiceId,
        groupId,
      });
      const member = typeof group?.activeProfileId === 'string' && group.activeProfileId.trim().length > 0
        ? group.activeProfileId.trim()
        : null;
      if (member) result.set(serviceId as ConnectedServiceId, member);
    } catch {
      // Best-effort: omit on failure → the emit falls back to the previous binding's profile.
    }
  }
  return result;
}
