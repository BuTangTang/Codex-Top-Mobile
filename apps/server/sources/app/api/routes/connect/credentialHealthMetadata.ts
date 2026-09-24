import type { Prisma } from "@prisma/client";
import {
    ConnectedServiceCredentialHealthV1Schema,
    type ConnectedServiceCredentialHealthV1,
} from "@happier-dev/protocol";

type MetadataIdentity = Readonly<{
    providerEmail?: string | null;
    providerAccountId?: string | null;
}>;

type MetadataWithHealth = MetadataIdentity & Readonly<{
    health?: ConnectedServiceCredentialHealthV1;
}>;

export function parseConnectedServiceCredentialHealth(raw: unknown): ConnectedServiceCredentialHealthV1 | undefined {
    if (raw === undefined || raw === null) return undefined;
    const parsed = ConnectedServiceCredentialHealthV1Schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
}

export function hasValidCredentialHealth(raw: unknown): boolean {
    return raw === undefined || raw === null || ConnectedServiceCredentialHealthV1Schema.safeParse(raw).success;
}

export function deriveConnectedServiceCredentialStatus(
    metadata: MetadataWithHealth | null | undefined,
): "connected" | "refreshing" | "needs_reauth" | "refresh_failed_retryable" {
    if (!metadata) return "needs_reauth";
    const health = metadata.health;
    if (!health) return "connected";
    if (health.reconnectRequired || health.status === "needs_reauth") return "needs_reauth";
    return health.status;
}

export function withCredentialHealth<TMetadata extends object>(
    metadata: TMetadata,
    health: ConnectedServiceCredentialHealthV1,
): Prisma.InputJsonValue {
    return { ...metadata, health } as Prisma.InputJsonValue;
}

export function withoutCredentialHealth<TMetadata extends object>(metadata: TMetadata): Prisma.InputJsonValue {
    const { health: _health, ...rest } = metadata as TMetadata & { health?: unknown };
    return rest as Prisma.InputJsonValue;
}

function changedStableIdentity(existing: string | null | undefined, incoming: string | null | undefined): boolean {
    return Boolean(existing && incoming && existing !== incoming);
}

function lostStableIdentity(existing: string | null | undefined, incoming: string | null | undefined): boolean {
    return Boolean(existing && !incoming);
}

export function isConnectedServiceProviderIdentityMismatch(params: Readonly<{
    existing: MetadataIdentity | null | undefined;
    incoming: MetadataIdentity;
}>): boolean {
    return lostStableIdentity(params.existing?.providerAccountId, params.incoming.providerAccountId)
        || lostStableIdentity(params.existing?.providerEmail, params.incoming.providerEmail)
        || changedStableIdentity(params.existing?.providerAccountId, params.incoming.providerAccountId)
        || changedStableIdentity(params.existing?.providerEmail, params.incoming.providerEmail);
}
