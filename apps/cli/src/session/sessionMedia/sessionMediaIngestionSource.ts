import type { SessionMediaItemV1 as ProtocolSessionMediaItemV1, SessionMediaOriginV1 } from '@happier-dev/protocol';

export type SessionMediaIngestionSource =
    | Readonly<{
        kind: 'base64';
        data: string;
        mimeType: string;
        suggestedName?: string;
    }>
    | Readonly<{
        kind: 'local-file';
        path: string;
        mimeType?: string;
        suggestedName?: string;
    }>
    | Readonly<{
        kind: 'local-uri';
        uri: string;
        mimeType?: string;
        suggestedName?: string;
    }>
    | Readonly<{
        kind: 'provider-file';
        providerFileId: string;
        mimeType?: string;
        suggestedName?: string;
    }>;

export type SessionMediaOrigin = SessionMediaOriginV1;
export type SessionMediaItemV1 = ProtocolSessionMediaItemV1;
