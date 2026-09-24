import { describe, expect, it } from 'vitest';

import { extractAcpMediaContentBlocks } from './extractAcpMediaContentBlocks';

describe('extractAcpMediaContentBlocks', () => {
  it('uses a stable media fingerprint for chunk and final inline image dedupe keys', () => {
    const chunk = extractAcpMediaContentBlocks(
      [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
      {
        source: 'acp-content',
        originSource: 'acp-content',
      },
    );
    const final = extractAcpMediaContentBlocks(
      [
        { type: 'text', text: 'Generated image:' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
      {
        source: 'acp-content',
        originSource: 'acp-content',
      },
    );

    expect(chunk.media).toHaveLength(1);
    expect(final.media).toHaveLength(1);
    expect(chunk.media[0]?.dedupeKey).toBe(final.media[0]?.dedupeKey);
  });

  it('rejects inline image data that does not sniff as an image', () => {
    const result = extractAcpMediaContentBlocks(
      [{ type: 'image', data: Buffer.from('not an image', 'utf8').toString('base64'), mimeType: 'image/png' }],
      {
        source: 'acp-content',
        originSource: 'acp-content',
      },
    );

    expect(result.media).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: 'unsupported_mime',
        contentIndex: 0,
        message: 'Unsupported image MIME type',
      },
    ]);
  });

  it('caps suggested names before exposing media sources to persistence', () => {
    const result = extractAcpMediaContentBlocks(
      [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png', name: ` ${'a'.repeat(400)}\0.png ` }],
      {
        source: 'acp-content',
        originSource: 'acp-content',
      },
    );

    expect(result.media[0]?.suggestedName).toMatch(/^a+/);
    expect(result.media[0]?.suggestedName).not.toContain('\0');
    expect(result.media[0]?.suggestedName?.length).toBeLessThanOrEqual(160);
  });
});
