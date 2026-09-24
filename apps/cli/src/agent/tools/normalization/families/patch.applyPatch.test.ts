import { describe, expect, it } from 'vitest';

import { normalizePatchInput } from './patch';

describe('normalizePatchInput (apply_patch patchText)', () => {
  it('infers a non-empty changes map from apply_patch patchText headers', () => {
    const normalized = normalizePatchInput({
      patchText: [
        '*** Begin Patch',
        '*** Update File: e2e-edit-diff.txt',
        '@@',
        '-BEFORE',
        '+AFTER',
        '*** End Patch',
      ].join('\n'),
    });

    expect(normalized).toMatchObject({
      changes: {
        'e2e-edit-diff.txt': { type: 'update' },
      },
    });
  });

  it('normalizes Codex app-server file-change arrays into canonical changes maps', () => {
    const normalized = normalizePatchInput({
      changes: [
        {
          path: '/tmp/probe/added.txt',
          kind: { type: 'add' },
          diff: 'Line one\nLine two\n',
        },
        {
          path: '/tmp/probe/existing.txt',
          kind: { type: 'update', move_path: null },
          diff: [
            '@@ -1,3 +1,4 @@',
            ' Alpha',
            '-Beta',
            '+Beta-updated',
            ' Gamma',
            '+Delta',
          ].join('\n'),
        },
        {
          path: '/tmp/probe/delete-me.txt',
          kind: { type: 'delete' },
          diff: 'remove this file\n',
        },
      ],
    });

    expect(normalized).toMatchObject({
      changes: {
        '/tmp/probe/added.txt': {
          type: 'add',
          add: { content: 'Line one\nLine two\n' },
        },
        '/tmp/probe/existing.txt': {
          type: 'update',
          modify: {
            old_content: 'Alpha\nBeta\nGamma',
            new_content: 'Alpha\nBeta-updated\nGamma\nDelta',
          },
        },
        '/tmp/probe/delete-me.txt': {
          type: 'delete',
          delete: { content: 'remove this file\n' },
        },
      },
    });
  });
});
