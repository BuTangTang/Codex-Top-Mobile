import { describe, expect, it } from 'vitest';

import { adoptReasoningEffortOverrideFromMessageMeta } from './adoptReasoningEffortOverrideFromMessageMeta';

describe('adoptReasoningEffortOverrideFromMessageMeta', () => {
  it('adopts a newer reasoningEffort override from user-message meta', () => {
    const res = adoptReasoningEffortOverrideFromMessageMeta({
      currentValueId: null,
      currentUpdatedAt: 0,
      messageMeta: {
        reasoningEffort: 'low',
      },
      updatedAt: 12,
    });

    expect(res).toEqual({ valueId: 'low', updatedAt: 12, didChange: true });
  });

  it('supports the legacy reasoning_effort alias in message meta', () => {
    const res = adoptReasoningEffortOverrideFromMessageMeta({
      currentValueId: null,
      currentUpdatedAt: 0,
      messageMeta: {
        reasoning_effort: 'medium',
      },
      updatedAt: 15,
    });

    expect(res).toEqual({ valueId: 'medium', updatedAt: 15, didChange: true });
  });

  it('does not change when no reasoning effort override is present', () => {
    const res = adoptReasoningEffortOverrideFromMessageMeta({
      currentValueId: 'high',
      currentUpdatedAt: 20,
      messageMeta: {
        model: 'claude-sonnet-4-6',
      },
      updatedAt: 25,
    });

    expect(res).toEqual({ valueId: 'high', updatedAt: 20, didChange: false });
  });
});
