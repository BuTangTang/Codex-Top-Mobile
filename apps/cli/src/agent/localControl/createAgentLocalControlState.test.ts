import { describe, expect, it } from 'vitest';

import { createAgentLocalControlState } from './createAgentLocalControlState';

describe('createAgentLocalControlState', () => {
  it('does not infer remote writeability from shared attached topology', () => {
    expect(createAgentLocalControlState({
      attached: true,
      topology: 'shared',
    })).toMatchObject({
      attached: true,
      topology: 'shared',
      remoteWritable: false,
    });
  });

  it('keeps remote writeability explicit for provider-native remote loops', () => {
    expect(createAgentLocalControlState({
      attached: true,
      topology: 'shared',
      remoteWritable: true,
    })).toMatchObject({
      attached: true,
      topology: 'shared',
      remoteWritable: true,
    });
  });
});
