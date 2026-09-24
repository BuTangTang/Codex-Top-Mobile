import { describe, expect, it } from 'vitest';

import { UpdateBodySchema } from './updates.js';

describe('updates sharing', () => {
  it('accepts session-shared updates without encryptedDataKey', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'session-shared',
      sessionId: 'sess_1',
      shareId: 'share_1',
      sharedBy: { id: 'u1', firstName: null, lastName: null, username: null, avatar: null },
      accessLevel: 'view',
      canApprovePermissions: false,
      createdAt: Date.now(),
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts session-share-updated permission delegation projections', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'session-share-updated',
      sessionId: 'sess_1',
      shareId: 'share_1',
      accessLevel: 'admin',
      canApprovePermissions: true,
      updatedAt: Date.now(),
    });
    expect(parsed.success).toBe(true);
  });
});
