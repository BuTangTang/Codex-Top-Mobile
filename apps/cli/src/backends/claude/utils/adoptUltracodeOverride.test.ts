import { describe, expect, it } from 'vitest';

import {
  adoptUltracodeOverrideFromMessageMeta,
  adoptUltracodeOverrideFromMetadata,
} from './adoptUltracodeOverride';

describe('adoptUltracodeOverrideFromMetadata', () => {
  it('returns didChange=false when no override is present', () => {
    const res = adoptUltracodeOverrideFromMetadata({
      currentValue: null,
      currentUpdatedAt: 0,
      metadata: null,
    });
    expect(res).toEqual({ value: null, updatedAt: 0, didChange: false });
  });

  it('adopts a newer ultracode override from session metadata', () => {
    const res = adoptUltracodeOverrideFromMetadata({
      currentValue: null,
      currentUpdatedAt: 0,
      metadata: {
        sessionConfigOptionOverridesV1: {
          v: 1,
          updatedAt: 10,
          overrides: {
            ultracode: { updatedAt: 12, value: 'true' },
          },
        },
      } as unknown as import('@/api/types').Metadata,
    });
    expect(res).toEqual({ value: true, updatedAt: 12, didChange: true });
  });

  it('adopts an explicit off override', () => {
    const res = adoptUltracodeOverrideFromMetadata({
      currentValue: true,
      currentUpdatedAt: 5,
      metadata: {
        sessionConfigOptionOverridesV1: {
          v: 1,
          updatedAt: 10,
          overrides: {
            ultracode: { updatedAt: 12, value: 'false' },
          },
        },
      } as unknown as import('@/api/types').Metadata,
    });
    expect(res).toEqual({ value: false, updatedAt: 12, didChange: true });
  });

  it('does not change when the override is not newer than the current updatedAt', () => {
    const res = adoptUltracodeOverrideFromMetadata({
      currentValue: true,
      currentUpdatedAt: 50,
      metadata: {
        sessionConfigOptionOverridesV1: {
          v: 1,
          updatedAt: 10,
          overrides: {
            ultracode: { updatedAt: 12, value: 'false' },
          },
        },
      } as unknown as import('@/api/types').Metadata,
    });
    expect(res).toEqual({ value: true, updatedAt: 50, didChange: false });
  });
});

describe('adoptUltracodeOverrideFromMessageMeta', () => {
  it('adopts a newer ultracode boolean from message meta', () => {
    const res = adoptUltracodeOverrideFromMessageMeta({
      currentValue: null,
      currentUpdatedAt: 0,
      messageMeta: { ultracode: true },
      updatedAt: 20,
    });
    expect(res).toEqual({ value: true, updatedAt: 20, didChange: true });
  });

  it('ignores message meta without an ultracode key or with a stale timestamp', () => {
    expect(adoptUltracodeOverrideFromMessageMeta({
      currentValue: true,
      currentUpdatedAt: 30,
      messageMeta: {},
      updatedAt: 40,
    })).toEqual({ value: true, updatedAt: 30, didChange: false });

    expect(adoptUltracodeOverrideFromMessageMeta({
      currentValue: true,
      currentUpdatedAt: 30,
      messageMeta: { ultracode: false },
      updatedAt: 10,
    })).toEqual({ value: true, updatedAt: 30, didChange: false });
  });

  it('accepts string boolean encodings from message meta', () => {
    expect(adoptUltracodeOverrideFromMessageMeta({
      currentValue: null,
      currentUpdatedAt: 0,
      messageMeta: { ultracode: 'true' },
      updatedAt: 5,
    })).toEqual({ value: true, updatedAt: 5, didChange: true });

    expect(adoptUltracodeOverrideFromMessageMeta({
      currentValue: true,
      currentUpdatedAt: 1,
      messageMeta: { ultracode: 'false' },
      updatedAt: 5,
    })).toEqual({ value: false, updatedAt: 5, didChange: true });
  });
});
