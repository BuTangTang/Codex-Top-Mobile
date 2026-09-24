import type { ConnectedServiceAuthGroupV1 } from '@happier-dev/protocol';

type ProjectedGroup = Readonly<{
  groupId?: string;
  displayName?: string | null;
  memberProfileIds?: ReadonlyArray<string>;
}>;

function readGroupLabel(groupId: string | undefined, displayName: string | null | undefined): string {
  const trimmedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
  if (trimmedDisplayName) return trimmedDisplayName;
  return typeof groupId === 'string' && groupId.trim() ? groupId.trim() : '';
}

export function resolveConnectedServiceProfileGroupReferenceLabels(params: Readonly<{
  profileId: string;
  groups?: ReadonlyArray<ConnectedServiceAuthGroupV1>;
  projectedGroups?: ReadonlyArray<ProjectedGroup>;
}>): ReadonlyArray<string> {
  const labelsById = new Map<string, string>();

  for (const group of params.groups ?? []) {
    if (!group.members.some((member) => member.profileId === params.profileId)) continue;
    const label = readGroupLabel(group.groupId, group.displayName);
    if (label) labelsById.set(group.groupId, label);
  }

  for (const group of params.projectedGroups ?? []) {
    const groupId = typeof group.groupId === 'string' ? group.groupId.trim() : '';
    if (!groupId || !group.memberProfileIds?.includes(params.profileId)) continue;
    const label = readGroupLabel(groupId, group.displayName);
    if (label && !labelsById.has(groupId)) labelsById.set(groupId, label);
  }

  return [...labelsById.values()];
}

export function formatConnectedServiceProfileGroupReferenceLabels(labels: ReadonlyArray<string>): string {
  return labels.join(', ');
}
