import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertSessionMediaMetadataIsPortable,
  createGeneratedSessionMediaFixture,
} from './sessionMedia';

describe('session media testkit fixtures', () => {
  it('creates a generated image fixture with portable session_media metadata', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-session-media-fixture-'));

    try {
      const fixture = await createGeneratedSessionMediaFixture({
        workspaceDir,
        messageLocalId: 'message-1',
      });

      expect(fixture.metadataEnvelope).toMatchObject({
        kind: 'session_media.v1',
        payload: {
          media: [{
            role: 'output',
            category: 'generated',
            mediaKind: 'image',
            mimeType: 'image/png',
            origin: {
              source: 'provider-generated',
            },
          }],
        },
      });
      expect(fixture.metadataEnvelope.payload.media).toHaveLength(1);
      const [media] = fixture.metadataEnvelope.payload.media;
      expect(media?.path).toMatch(/^\.happier\/uploads\/generated\/message-1\/.+\.png$/);
      expect(media?.path).not.toContain(workspaceDir);
      expect(resolve(workspaceDir, media!.path)).toBe(fixture.mediaPath);
      await expect(readFile(fixture.mediaPath)).resolves.toEqual(fixture.mediaBytes);
      expect(() => assertSessionMediaMetadataIsPortable(fixture.metadataEnvelope)).not.toThrow();
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe message path segments before writing media files', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-session-media-fixture-'));

    try {
      await expect(createGeneratedSessionMediaFixture({
        workspaceDir,
        messageLocalId: '../../provider-temp',
      })).rejects.toThrow(/messageLocalId/);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('rejects portable metadata checks with path traversal segments', () => {
    expect(() => assertSessionMediaMetadataIsPortable({
      kind: 'session_media.v1',
      payload: {
        media: [{
          path: '.happier/uploads/generated/../provider-temp/generated-image.png',
        }],
      },
    })).toThrow(/relative session file path/);
  });
});
