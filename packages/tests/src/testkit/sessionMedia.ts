import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type GeneratedSessionMediaFixture = Readonly<{
  messageLocalId: string;
  mediaBytes: Buffer;
  mediaPath: string;
  metadataEnvelope: {
    kind: 'session_media.v1';
    payload: {
      media: readonly {
        id: string;
        role: 'output';
        category: 'generated';
        mediaKind: 'image';
        mimeType: 'image/png';
        name: string;
        path: string;
        sizeBytes: number;
        sha256: string;
        origin: {
          source: 'provider-generated';
          agentId: string;
          generationId: string;
          providerEventId: string;
        };
      }[];
    };
  };
  assistantRecord: {
    role: 'agent';
    content: { type: 'output'; data: { message: { role: 'assistant'; content: [] } } };
    meta: {
      happier: GeneratedSessionMediaFixture['metadataEnvelope'];
    };
  };
}>;

const tinyPngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lU6w9wAAAABJRU5ErkJggg==',
  'base64',
);

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertSafeMessageLocalIdSegment(messageLocalId: string): void {
  if (
    messageLocalId.length === 0 ||
    messageLocalId === '.' ||
    messageLocalId === '..' ||
    messageLocalId.includes('/') ||
    messageLocalId.includes('\\')
  ) {
    throw new Error(`Invalid session media fixture messageLocalId: ${messageLocalId}`);
  }
}

export async function createGeneratedSessionMediaFixture(params: Readonly<{
  workspaceDir: string;
  messageLocalId?: string;
}>): Promise<GeneratedSessionMediaFixture> {
  const messageLocalId = params.messageLocalId ?? `message-${randomUUID()}`;
  assertSafeMessageLocalIdSegment(messageLocalId);
  const mediaId = randomUUID();
  const fileName = `${mediaId}-generated-image.png`;
  const relativeMediaPath = ['.happier', 'uploads', 'generated', messageLocalId, fileName].join('/');
  const mediaPath = join(params.workspaceDir, relativeMediaPath);
  await mkdir(join(params.workspaceDir, '.happier', 'uploads', 'generated', messageLocalId), { recursive: true });
  await writeFile(mediaPath, tinyPngBytes);

  const metadataEnvelope = {
    kind: 'session_media.v1',
    payload: {
      media: [{
        id: mediaId,
        role: 'output',
        category: 'generated',
        mediaKind: 'image',
        mimeType: 'image/png',
        name: fileName,
        path: relativeMediaPath,
        sizeBytes: tinyPngBytes.byteLength,
        sha256: sha256Hex(tinyPngBytes),
        origin: {
          source: 'provider-generated',
          agentId: 'claude',
          generationId: `generation-${mediaId}`,
          providerEventId: `event-${mediaId}`,
        },
      }],
    },
  } as const;

  return {
    messageLocalId,
    mediaBytes: tinyPngBytes,
    mediaPath,
    metadataEnvelope,
    assistantRecord: {
      role: 'agent',
      content: { type: 'output', data: { message: { role: 'assistant', content: [] } } },
      meta: { happier: metadataEnvelope },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function assertSessionMediaMetadataIsPortable(
  value: unknown,
  opts?: Readonly<{ forbiddenSubstrings?: readonly string[] }>,
): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(tinyPngBytes.toString('base64'))) {
    throw new Error('Session media metadata must not contain base64 image bytes');
  }
  if (serialized.includes('file://')) {
    throw new Error('Session media metadata must not contain file URLs');
  }
  if (serialized.includes('backendId')) {
    throw new Error('Session media metadata must not contain backendId');
  }
  for (const substring of opts?.forbiddenSubstrings ?? []) {
    if (substring && serialized.includes(substring)) {
      throw new Error(`Session media metadata must not contain ${substring}`);
    }
  }

  const envelope = isRecord(value) ? value : null;
  const payload = isRecord(envelope?.payload) ? envelope.payload : null;
  const media = Array.isArray(payload?.media) ? payload.media : [];
  for (const item of media) {
    if (!isRecord(item)) continue;
    const path = item.path;
    if (typeof path !== 'string') continue;
    if (
      path.startsWith('/') ||
      path.startsWith('\\') ||
      /^[a-z]:[\\/]/i.test(path) ||
      /^[a-z][a-z0-9+.-]*:/i.test(path) ||
      path.includes('\\') ||
      path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      throw new Error('Session media metadata path must be a relative session file path');
    }
  }
}
