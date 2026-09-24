import { describe, expect, it } from 'vitest';

describe('sessionWorkStateMetadata', () => {
  it('re-exports the protocol-owned metadata merge helper', async () => {
    const cliMod = await import('./sessionWorkStateMetadata');
    const protocol = await import('@happier-dev/protocol');

    expect(cliMod.mergeSessionWorkStateMetadataV1).toBe(protocol.mergeSessionWorkStateMetadataV1);

    const next = cliMod.mergeSessionWorkStateMetadataV1({
      metadata: {
        sessionWorkStateV1: {
          v: 1,
          backendId: 'opencode',
          updatedAt: 10,
          items: [
            {
              id: 'todo:old',
              kind: 'todo',
              origin: 'vendor',
              status: 'active',
              title: 'Old todo',
              updatedAt: 10,
            },
            {
              id: 'future:1',
              kind: 'future',
              origin: 'vendor',
              status: 'active',
              title: 'Future item',
              updatedAt: 10,
              futureField: { keep: true },
            },
          ],
          futureSnapshotField: 'keep',
        },
      },
      nextOwned: {
        v: 1,
        backendId: 'opencode',
        updatedAt: 20,
        items: [
          {
            id: 'todo:new',
            kind: 'todo',
            origin: 'vendor',
            status: 'pending',
            title: 'New todo',
            updatedAt: 20,
          },
        ],
        primaryItemId: 'todo:new',
      },
      ownedSourceFamilies: ['todo'],
    });

    const items = next.sessionWorkStateV1.items as Array<{ id?: unknown; futureField?: unknown }>;
    expect(items.map((item) => item.id)).toEqual(['future:1', 'todo:new']);
    expect(items[0]?.futureField).toEqual({ keep: true });
    expect(next.sessionWorkStateV1.futureSnapshotField).toBe('keep');
  });
});
