import { describe, expect, it, vi } from 'vitest';

import { createClaudeUnifiedTelemetrySink } from './telemetry';

describe('createClaudeUnifiedTelemetrySink', () => {
  it('writes structured safe unified telemetry through the CLI file logger', () => {
    const debug = vi.fn();
    const sink = createClaudeUnifiedTelemetrySink({
      logger: { debug },
    });

    sink.emit({
      name: 'unified.injection.outcome',
      properties: {
        status: 'deferred',
        reason: 'terminal_busy',
        hostKind: 'tmux',
        multiline: true,
        originKind: 'ui_pending',
      },
    });

    expect(debug).toHaveBeenCalledWith('[claude-unified-telemetry]', {
      event: 'unified.injection.outcome',
      hostKind: 'tmux',
      multiline: true,
      originKind: 'ui_pending',
      reason: 'terminal_busy',
      status: 'deferred',
    });
  });

  it('does not write zellij screen dump contents to host-dead telemetry', async () => {
    const debug = vi.fn();
    const { emitClaudeUnifiedHostDead } = await import('./telemetry');
    const sink = createClaudeUnifiedTelemetrySink({
      logger: { debug },
    });

    emitClaudeUnifiedHostDead(sink, {
      hostKind: 'zellij',
      sessionName: 'happier-claude',
      paneId: 'terminal_1',
      liveness: {
        paneAlive: false,
        paneDead: true,
        paneCurrentCommand: '/managed/node',
        paneExitStatus: 127,
        paneScreenDumpCaptured: true,
        paneScreenDumpTruncated: true,
        paneScreenDumpError: 'dump failed with SECRET_TOKEN=raw-secret',
        observedAt: 123,
      },
    });

    expect(debug).toHaveBeenCalledWith('[claude-unified-telemetry]', expect.objectContaining({
      event: 'unified.session.host_dead',
      paneScreenDumpCaptured: true,
      paneScreenDumpTruncated: true,
      paneScreenDumpErrorCaptured: true,
    }));
    const payload = JSON.stringify(debug.mock.calls[0]?.[1]);
    expect(payload).not.toContain('terminal prompt with user text');
    expect(payload).not.toContain('raw-secret');
    expect(payload).not.toContain('paneScreenDump":"');
  });

  it('includes zellij pane exit details in host-dead telemetry', async () => {
    const debug = vi.fn();
    const { emitClaudeUnifiedHostDead } = await import('./telemetry');
    const sink = createClaudeUnifiedTelemetrySink({
      logger: { debug },
    });

    emitClaudeUnifiedHostDead(sink, {
      hostKind: 'zellij',
      sessionName: 'happier-claude',
      paneId: 'terminal_1',
      liveness: {
        paneAlive: false,
        paneDead: true,
        paneCurrentCommand: '/managed/node',
        paneExitStatus: 127,
        observedAt: 123,
      },
    });

    expect(debug).toHaveBeenCalledWith('[claude-unified-telemetry]', {
      event: 'unified.session.host_dead',
      hostKind: 'zellij',
      observedAt: 123,
      paneAlive: false,
      paneCurrentCommand: '/managed/node',
      paneDead: true,
      paneExitStatus: 127,
      paneId: 'terminal_1',
      sessionName: 'happier-claude',
    });
  });
});
