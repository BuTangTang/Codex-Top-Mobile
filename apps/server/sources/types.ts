import { ImageRef } from "./storage/blob/files";
import type { LinkedProvider } from "./app/auth/providers/linkedProviders";
import type { AccountProfile as ProtocolAccountProfile } from "@happier-dev/protocol";

export type AccountProfile = {
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    avatar: ImageRef | null;
    linkedProviders: LinkedProvider[];
    settings: {
        value: string | null;
        version: number;
    } | null;
    settingsV2?: {
        content: unknown | null;
        version: number;
    } | null;
    connectedServices: string[];
    connectedServicesV2?: ProtocolAccountProfile["connectedServicesV2"];
}

export type ArtifactInfo = {
    id: string;
    header: string;
    headerVersion: number;
    dataEncryptionKey: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
}

export type Artifact = ArtifactInfo & {
    body: string;
    bodyVersion: number;
}
