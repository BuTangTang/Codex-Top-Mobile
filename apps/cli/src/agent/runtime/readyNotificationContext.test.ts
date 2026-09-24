import { describe, expect, it } from 'vitest';
import {
  getSessionNotificationAgentDisplayName,
  getSessionNotificationTitle,
} from './readyNotificationContext';

describe('readyNotificationContext', () => {
  it('normalizes session titles from metadata snapshots', () => {
    expect(getSessionNotificationTitle(() => ({
      summary: {
        text: '  Review branch  ',
      },
    }))).toBe('Review branch');

    expect(getSessionNotificationTitle(() => ({ summary: { text: '   ' }, name: '  Fallback name  ' }))).toBe('Fallback name');
    expect(getSessionNotificationTitle()).toBeNull();
  });

  it('resolves provider labels from session metadata snapshots', () => {
    expect(getSessionNotificationAgentDisplayName(() => ({ flavor: 'claude' }))).toBe('Claude Code CLI');
    expect(getSessionNotificationAgentDisplayName(() => ({ flavor: 'codex' }))).toBe('OpenAI Codex CLI');
    expect(getSessionNotificationAgentDisplayName()).toBeNull();
  });
});
