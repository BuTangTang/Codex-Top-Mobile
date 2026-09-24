import { describe, expect, it } from 'vitest';

import { isEmbeddedBunBundlePath } from './isEmbeddedBunBundlePath';

describe('isEmbeddedBunBundlePath', () => {
  it('recognizes Windows Bun virtual paths parsed from file URLs', () => {
    expect(isEmbeddedBunBundlePath('/B:/%7EBUN/root/happier.exe')).toBe(true);
    expect(isEmbeddedBunBundlePath('/B:/~BUN/root/happier.exe')).toBe(true);
  });

  it('recognizes POSIX Bun virtual paths', () => {
    expect(isEmbeddedBunBundlePath('/$bunfs/root/happier')).toBe(true);
    expect(isEmbeddedBunBundlePath('/~bun/root/happier')).toBe(true);
  });

  it('does not treat ordinary files with similar names as embedded Bun bundle paths', () => {
    expect(isEmbeddedBunBundlePath('/Users/test/~bundle/root/happier')).toBe(false);
    expect(isEmbeddedBunBundlePath('C:\\Users\\test\\happier-v0.2.10-windows-x64\\happier.exe')).toBe(false);
    expect(isEmbeddedBunBundlePath('/B:/Users/test/%7EBUN/root/happier.exe')).toBe(false);
  });
});
