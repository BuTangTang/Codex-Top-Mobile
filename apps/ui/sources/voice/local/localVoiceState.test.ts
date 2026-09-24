import { describe, expect, it, vi } from 'vitest';

describe('localVoiceState', () => {
  it('does not notify subscribers when a patch leaves state unchanged', async () => {
    vi.resetModules();

    const { patchLocalVoiceState, subscribeLocalVoiceState } = await import('./localVoiceState');
    patchLocalVoiceState({ status: 'idle', sessionId: null, error: null });

    const listener = vi.fn();
    const unsubscribe = subscribeLocalVoiceState(listener);

    try {
      patchLocalVoiceState({ status: 'idle', sessionId: null, error: null });
      expect(listener).not.toHaveBeenCalled();

      patchLocalVoiceState({ status: 'recording', sessionId: 'session-1', error: null });
      expect(listener).toHaveBeenCalledTimes(1);

      patchLocalVoiceState({ status: 'recording', sessionId: 'session-1' });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
