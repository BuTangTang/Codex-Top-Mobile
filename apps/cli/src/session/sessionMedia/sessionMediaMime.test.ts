import { describe, expect, it } from 'vitest';

import { sniffSessionMediaMimeType } from './sessionMediaMime';

describe('sniffSessionMediaMimeType', () => {
  it('sniffs PNG bytes', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(sniffSessionMediaMimeType(bytes)).toBe('image/png');
  });

  it('sniffs JPEG bytes', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    expect(sniffSessionMediaMimeType(bytes)).toBe('image/jpeg');
  });

  it('sniffs WebP bytes', () => {
    const bytes = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');

    expect(sniffSessionMediaMimeType(bytes)).toBe('image/webp');
  });
});
