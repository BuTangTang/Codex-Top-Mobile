import { describe, expect, it } from 'vitest';

import { DefaultTransport } from '@/agent/transport';
import { CursorTransport } from '../acp/transport';
import { sanitizeCursorDiffContent } from './sanitizeCursorDiffContent';

describe('sanitizeCursorDiffContent', () => {
  it('strips Cursor file-add diff header noise (real captured payload)', () => {
    const update = {
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      content: [
        {
          type: 'diff',
          path: '/Users/leeroy/hello.py',
          oldText: '-- /dev/null\n',
          newText: '++ b//Users/leeroy/hello.py\nprint("hello world")',
        },
      ],
    };

    const result = sanitizeCursorDiffContent(update);

    expect((result.content as any[])[0]).toEqual({
      type: 'diff',
      path: '/Users/leeroy/hello.py',
      oldText: '',
      newText: 'print("hello world")',
    });
  });

  it('strips standard ---/+++ headers on a real edit, preserving body content', () => {
    const update = {
      content: [
        {
          type: 'diff',
          path: '/x.ts',
          oldText: '--- a/x.ts\nconst a = 1;\nconst b = 2;',
          newText: '+++ b/x.ts\nconst a = 1;\nconst b = 3;',
        },
      ],
    };

    const result = sanitizeCursorDiffContent(update);

    expect((result.content as any[])[0]).toMatchObject({
      oldText: 'const a = 1;\nconst b = 2;',
      newText: 'const a = 1;\nconst b = 3;',
    });
  });

  it('leaves non-diff content blocks untouched', () => {
    const update = { content: [{ type: 'content', content: { type: 'text', text: '-- not a diff' } }] };
    expect(sanitizeCursorDiffContent(update)).toBe(update);
  });

  it('does not strip real code lines that merely start with -- or ++', () => {
    const update = {
      content: [
        {
          type: 'diff',
          path: '/q.sql',
          oldText: '-- this is a SQL comment\nSELECT 1;',
          newText: '++value still counts\nSELECT 2;',
        },
      ],
    };
    // Neither first line is a unified-diff *file header* (no /dev/null or a//b/ path), so keep them.
    expect(sanitizeCursorDiffContent(update)).toBe(update);
  });

  it('returns the same reference when content is absent or not an array', () => {
    const a = { content: 'plain string' };
    const b: { content?: unknown; status: string } = { status: 'completed' };
    expect(sanitizeCursorDiffContent(a)).toBe(a);
    expect(sanitizeCursorDiffContent(b)).toBe(b);
  });

  it('is wired via the transport seam: CursorTransport sanitizes, DefaultTransport is a no-op', () => {
    const dirty = {
      content: [{ type: 'diff', path: '/x.py', oldText: '-- /dev/null\n', newText: '++ b/x.py\nhi' }],
    };
    const cursor = new CursorTransport().sanitizeToolUpdateContent(dirty);
    expect((cursor.content as any[])[0]).toMatchObject({ oldText: '', newText: 'hi' });
    // Generic transport must not touch provider payloads.
    expect(new DefaultTransport('test').sanitizeToolUpdateContent(dirty)).toBe(dirty);
  });
});
