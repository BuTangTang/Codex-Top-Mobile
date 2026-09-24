import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { createTestAuth } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import { decryptLegacyBase64, encryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createSessionWithCiphertexts, fetchAllMessages } from '../../src/testkit/sessions';
import {
  assertSessionMediaMetadataIsPortable,
  createGeneratedSessionMediaFixture,
} from '../../src/testkit/sessionMedia';

const run = createRunDirs({ runLabel: 'core' });

describe('core e2e: generated session media metadata roundtrip', () => {
  let server: StartedServer | null = null;

  afterEach(async () => {
    await server?.stop().catch(() => {});
    server = null;
  });

  it('preserves media-only assistant session_media metadata without durable byte leakage', async () => {
    const testDir = run.testDir('session-media-generated-metadata-roundtrip');
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-session-media-e2e-'));

    try {
      server = await startServerLight({ testDir, dbProvider: 'sqlite' });
      const auth = await createTestAuth(server.baseUrl);
      const secret = Uint8Array.from(randomBytes(32));
      const initialCiphertext = encryptLegacyBase64({ v: 1, name: 'session-media-generated-roundtrip' }, secret);
      const { sessionId } = await createSessionWithCiphertexts({
        baseUrl: server.baseUrl,
        token: auth.token,
        tag: `e2e-session-media-generated-${randomUUID()}`,
        metadataCiphertextBase64: initialCiphertext,
        agentStateCiphertextBase64: null,
      });

      const fixture = await createGeneratedSessionMediaFixture({
        workspaceDir,
        messageLocalId: 'assistant-media-only',
      });
      assertSessionMediaMetadataIsPortable(fixture.metadataEnvelope, {
        forbiddenSubstrings: [workspaceDir, 'provider-temp'],
      });

      const localId = `session-media-${randomUUID()}`;
      const ciphertext = encryptLegacyBase64(fixture.assistantRecord, secret);
      const res = await fetchJson<{ didWrite?: boolean }>(`${server.baseUrl}/v2/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciphertext, localId }),
        timeoutMs: 20_000,
      });
      expect(res.status).toBe(200);
      expect(res.data?.didWrite).toBe(true);

      const rows = await fetchAllMessages(server.baseUrl, auth.token, sessionId);
      const row = rows.find((candidate) => candidate.localId === localId);
      expect(row).toBeTruthy();
      const decoded = decryptLegacyBase64(row!.content.c, secret) as typeof fixture.assistantRecord;

      expect(decoded.role).toBe('agent');
      expect(decoded.content.data.message.content).toEqual([]);
      expect(decoded.meta.happier).toEqual(fixture.metadataEnvelope);
      assertSessionMediaMetadataIsPortable(decoded.meta.happier, {
        forbiddenSubstrings: [workspaceDir, 'provider-temp'],
      });

      const [media] = decoded.meta.happier.payload.media;
      expect(media?.path).toMatch(/^\.happier\/uploads\/generated\/assistant-media-only\/.+\.png$/);
      await expect(readFile(resolve(workspaceDir, media!.path))).resolves.toEqual(fixture.mediaBytes);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }, 120_000);
});
