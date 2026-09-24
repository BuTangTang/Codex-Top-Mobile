import { describe, expect, it } from 'vitest';

import {
  SessionTerminalComposerClearRequestV1Schema,
  SessionTerminalComposerClearResultV1Schema,
} from './sessionTerminalComposerClearV1.js';

describe('session terminal composer clear contract', () => {
  it('accepts provider-neutral clear requests with an optional expected state timestamp', () => {
    expect(SessionTerminalComposerClearRequestV1Schema.parse({
      sessionId: 'sess_1',
      expectedStateAtMs: 1_700_000_000_000,
    })).toEqual({
      sessionId: 'sess_1',
      expectedStateAtMs: 1_700_000_000_000,
    });

    expect(SessionTerminalComposerClearRequestV1Schema.safeParse({
      sessionId: '   ',
    }).success).toBe(false);
    expect(SessionTerminalComposerClearRequestV1Schema.safeParse({
      sessionId: 'sess_1',
      expectedStateAtMs: -1,
    }).success).toBe(false);
  });

  it('normalizes typed success and failure statuses without provider-specific details', () => {
    expect(SessionTerminalComposerClearResultV1Schema.parse({
      ok: true,
      status: 'cleared',
      sessionId: 'sess_1',
    })).toEqual({
      ok: true,
      status: 'cleared',
      sessionId: 'sess_1',
    });
    expect(SessionTerminalComposerClearResultV1Schema.parse({
      ok: true,
      status: 'already_empty',
      sessionId: 'sess_1',
    })).toEqual({
      ok: true,
      status: 'already_empty',
      sessionId: 'sess_1',
    });
    expect(SessionTerminalComposerClearResultV1Schema.parse({
      ok: false,
      status: 'not_safe',
      errorCode: 'dialog_open',
      sessionId: 'sess_1',
    })).toEqual({
      ok: false,
      status: 'not_safe',
      errorCode: 'dialog_open',
      sessionId: 'sess_1',
    });
    expect(SessionTerminalComposerClearResultV1Schema.safeParse({
      ok: false,
      status: 'claude_menu_open',
      sessionId: 'sess_1',
    }).success).toBe(false);
  });
});
