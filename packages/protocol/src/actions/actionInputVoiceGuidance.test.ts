import { describe, expect, it } from 'vitest';

import { getActionInputFieldVoiceNotes, getActionVoiceWorkflowNotes } from './actionInputVoiceGuidance.js';

describe('actionInputVoiceGuidance', () => {
  it('uses backendTargetKeys in backend-selection guidance', () => {
    const fieldNotes = getActionInputFieldVoiceNotes(
      { id: 'subagents.plan.start' },
      { path: 'backendTargetKeys', optionsSourceId: 'execution.backends.enabled' } as any,
    ).join(' ');
    const workflowNotes = getActionVoiceWorkflowNotes('subagents.plan.start').join(' ');

    expect(fieldNotes).toContain('backendTargetKeys');
    expect(fieldNotes).toContain('provider/backend targets');
    expect(fieldNotes).toContain('not as parallelism capacity');
    expect(fieldNotes).not.toContain('backendIds');
    expect(workflowNotes).toContain('backendTargetKeys');
    expect(workflowNotes).toContain('provider/backend targets');
    expect(workflowNotes).not.toContain('backendIds');
  });

  it('prefers transcript access over activity for transcript-reading prompts', () => {
    const workflowNotes = getActionVoiceWorkflowNotes('session.activity.get').join(' ');
    const recentNotes = getActionVoiceWorkflowNotes('session.messages.recent.get').join(' ');
    const transcriptFieldNotes = getActionInputFieldVoiceNotes(
      { id: 'session.transcript.get' },
      { path: 'sessionId', title: 'Session id', widget: 'text' } as any,
    ).join(' ');

    expect(workflowNotes).toContain('Use getSessionTranscript instead when the user asks what was said');
    expect(workflowNotes).toContain('lightweight status or activity digest');
    expect(recentNotes).toContain('Use getSessionTranscript');
    expect(transcriptFieldNotes).toContain('Use listSessions');
  });
});
