import { describe, expect, it } from 'vitest';
import * as protocol from '../index.js';

type SchemaLike = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean; data?: unknown }>;
}>;

describe('connectedServiceMaterializationIdentityV1', () => {
  it('exports a typed session metadata schema and builder', () => {
    const exportsByName = protocol as unknown as Record<string, unknown>;
    const schema = exportsByName.ConnectedServiceMaterializationIdentityV1Schema as SchemaLike | undefined;
    const builder = exportsByName.buildConnectedServiceMaterializationIdentityV1 as
      | ((params: Readonly<{ id: string; createdAtMs: number }>) => unknown)
      | undefined;

    expect(schema).toBeDefined();
    expect(builder).toEqual(expect.any(Function));

    const built = builder?.({ id: 'csm_stable_1', createdAtMs: 123 });
    expect(schema?.safeParse(built)).toMatchObject({
      success: true,
      data: {
        v: 1,
        id: 'csm_stable_1',
        createdAtMs: 123,
      },
    });
    expect(schema?.safeParse({ v: 1, id: '../provider-home', createdAtMs: 123 }).success).toBe(false);
  });

  it('accepts the dev-tree identity timestamp shape (createdAt) and normalizes it to createdAtMs', () => {
    const parsed = protocol.ConnectedServiceMaterializationIdentityV1Schema.safeParse({
      v: 1,
      id: 'csm_dev_shape',
      createdAt: 456,
    });
    expect(parsed).toMatchObject({
      success: true,
      data: {
        v: 1,
        id: 'csm_dev_shape',
        createdAtMs: 456,
      },
    });

    const fromMetadata = protocol.readConnectedServiceMaterializationIdentityV1FromMetadata({
      connectedServiceMaterializationIdentityV1: { v: 1, id: 'csm_dev_shape', createdAt: 456 },
    });
    expect(fromMetadata).toMatchObject({ id: 'csm_dev_shape', createdAtMs: 456 });
  });

  it('prefers the canonical createdAtMs when both timestamp shapes are present', () => {
    const parsed = protocol.ConnectedServiceMaterializationIdentityV1Schema.safeParse({
      v: 1,
      id: 'csm_both_shapes',
      createdAtMs: 123,
      createdAt: 456,
    });
    expect(parsed).toMatchObject({
      success: true,
      data: {
        v: 1,
        id: 'csm_both_shapes',
        createdAtMs: 123,
      },
    });
  });
});
