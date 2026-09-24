export type ConnectedServiceIdentityProfileLike = Readonly<{
    profileId?: string | null;
    label?: string | null;
    providerEmail?: string | null;
}>;

export type ConnectedServiceIdentityGroupLike = Readonly<{
    groupId?: string | null;
    label?: string | null;
    activeProfileId?: string | null;
}>;

export type ConnectedServiceIdentityDisplay = Readonly<{
    primaryLabel: string;
    secondaryLabel?: string;
    compactLabel: string;
    diagnosticLabel: string;
    profileId?: string;
    providerEmail?: string;
    warning?: 'label_masks_stable_identity';
}>;

export type ConnectedServiceGroupIdentityDisplay = Readonly<{
    primaryLabel: string;
    compactLabel: string;
    diagnosticLabel: string;
    groupId?: string;
    activeProfileId?: string;
    activeMember?: ConnectedServiceIdentityDisplay;
}>;

function readIdentityString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function uniqueNonEmpty(values: ReadonlyArray<string>): string[] {
    const out: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || out.includes(trimmed)) continue;
        out.push(trimmed);
    }
    return out;
}

function joinSecondaryIdentityParts(values: ReadonlyArray<string>): string {
    return uniqueNonEmpty(values).join(' · ');
}

export function resolveConnectedServiceProfileIdentityDisplay(
    profile: ConnectedServiceIdentityProfileLike,
): ConnectedServiceIdentityDisplay {
    const profileId = readIdentityString(profile.profileId);
    const label = readIdentityString(profile.label);
    const providerEmail = readIdentityString(profile.providerEmail);
    const primaryLabel = label || providerEmail || profileId;
    const secondaryLabel = label
        ? joinSecondaryIdentityParts([providerEmail, profileId !== label ? profileId : ''])
        : joinSecondaryIdentityParts([providerEmail && profileId !== providerEmail ? profileId : '']);
    const diagnosticParts = uniqueNonEmpty([primaryLabel, providerEmail, profileId]);
    const labelMasksStableIdentity = Boolean(label && (
        (providerEmail && providerEmail !== label)
        || (profileId && profileId !== label)
    ));

    return {
        primaryLabel,
        ...(secondaryLabel ? { secondaryLabel } : {}),
        compactLabel: providerEmail || primaryLabel,
        diagnosticLabel: diagnosticParts.join(' · ') || primaryLabel,
        ...(profileId ? { profileId } : {}),
        ...(providerEmail ? { providerEmail } : {}),
        ...(labelMasksStableIdentity ? { warning: 'label_masks_stable_identity' as const } : {}),
    };
}

export function formatConnectedServiceIdentityVisibleLabel(display: ConnectedServiceIdentityDisplay): string {
    return display.secondaryLabel
        ? `${display.primaryLabel} · ${display.secondaryLabel}`
        : display.primaryLabel;
}

export function resolveConnectedServiceGroupIdentityDisplay(params: Readonly<{
    group: ConnectedServiceIdentityGroupLike;
    profiles: ReadonlyArray<ConnectedServiceIdentityProfileLike>;
}>): ConnectedServiceGroupIdentityDisplay {
    const groupId = readIdentityString(params.group.groupId);
    const primaryLabel = readIdentityString(params.group.label) || groupId;
    const activeProfileId = readIdentityString(params.group.activeProfileId);
    const activeProfile = activeProfileId
        ? params.profiles.find((profile) => readIdentityString(profile.profileId) === activeProfileId) ?? { profileId: activeProfileId }
        : null;
    const activeMember = activeProfile
        ? resolveConnectedServiceProfileIdentityDisplay(activeProfile)
        : undefined;
    const compactLabel = activeMember
        ? `${primaryLabel} (${activeMember.compactLabel})`
        : primaryLabel;
    const diagnosticLabel = activeMember
        ? `${primaryLabel} (${activeMember.diagnosticLabel})`
        : primaryLabel;

    return {
        primaryLabel,
        compactLabel,
        diagnosticLabel,
        ...(groupId ? { groupId } : {}),
        ...(activeProfileId ? { activeProfileId } : {}),
        ...(activeMember ? { activeMember } : {}),
    };
}
